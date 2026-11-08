const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");

const server = readFileSync("server.mjs", "utf8");
const slice = (start, end) => {
  const from = server.indexOf(start), to = server.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return server.slice(from, to);
};
const minute = 60_000;
const initialTime = Date.parse("2026-11-08T12:00:00Z");
const endpoint = "sports/basketball_nba/events/test-event/odds/";
const params = { regions: "us", markets: "player_points", oddsFormat: "decimal", includeLinks: "true" };
const plain = value => JSON.parse(JSON.stringify(value));

async function setup({ start = initialTime + 3 * 60 * minute, empty = false, missing = [], request, oddsProvider = "the-odds-api" } = {}) {
  const { propsTtlMs, bestParlayMarkets } = await import("./best-parlay.mjs");
  let now = initialTime;
  const requests = [];
  const context = {
    Date: class extends Date { static now() { return now; } },
    propsTtlMs, bestParlayMarkets, regions: "us", oddsProvider, marketsWithoutAlternates: new Set(),
    sportsDataIO: { request: async () => { throw new Error("SportsDataIO was not expected"); } },
    requestOddsApi: async (path, parameters) => {
      requests.push({ path, parameters: plain(parameters) });
      if (request) await request(requests.length);
      return {
        id: "test-event",
        commence_time: typeof start === "number" ? new Date(start).toISOString() : start,
        bookmakers: empty ? [] : [{
          key: parameters.bookmakers || "fanduel",
          markets: (parameters.markets || "").split(",").filter(key => !missing.includes(key))
            .map(key => ({ key, last_update: new Date(now).toISOString(),
              outcomes: [{ name: "Over", description: "Test Player", point: 20.5, price: 1.9 }] }))
        }]
      };
    }
  };
  runInNewContext(slice("async function fetchOddsApi(", "async function requestOddsApi(") +
    slice("const apiCache = new Map();", "async function buildParlayResponse("), context);
  return { context, requests, advance: ms => { now += ms; } };
}

test("pre-game checks use four provider requests per hour instead of sixty", async () => {
  const { context: c, requests, advance } = await setup();
  let previous;
  for (let check = 0; check < 60; check++) {
    const result = await c.fetchOddsApi(endpoint, params);
    const expectedFetch = initialTime + Math.floor(check / 15) * 15 * minute;
    assert.equal(result.oddsFetchedAt, new Date(expectedFetch).toISOString());
    if (check % 15) assert.deepEqual(plain(result), previous);
    previous = plain(result);
    advance(minute);
  }
  assert.equal(requests.length, 4);
});

test("near-game cache lasts eight minutes, but expires exactly when the game starts", async () => {
  for (const [untilStart, ttl] of [[30 * minute, 8 * minute], [2 * minute, 2 * minute]]) {
    const { context: c, requests, advance } = await setup({ start: initialTime + untilStart });
    await c.fetchOddsApi(endpoint, params);
    advance(ttl - 1);
    await c.fetchOddsApi(endpoint, params);
    assert.equal(requests.length, 1);
    advance(1);
    await c.fetchOddsApi(endpoint, params);
    assert.equal(requests.length, 2);
    if (untilStart === ttl) {
      advance(minute - 1);
      await c.fetchOddsApi(endpoint, params);
      assert.equal(requests.length, 2);
      advance(1);
      await c.fetchOddsApi(endpoint, params);
      assert.equal(requests.length, 3, "the former pre-game entry now expires every minute");
    }
  }
});

test("live, unknown-start and empty prices retry after sixty seconds", async () => {
  for (const options of [{ start: initialTime }, { start: "unknown" }, { empty: true }]) {
    const { context: c, requests, advance } = await setup(options);
    await c.fetchOddsApi(endpoint, params);
    advance(minute - 1);
    await c.fetchOddsApi(endpoint, params);
    assert.equal(requests.length, 1);
    advance(1);
    await c.fetchOddsApi(endpoint, params);
    assert.equal(requests.length, 2);
  }
});

test("parlays, guests and player props reuse a full price response without exposing extra markets", async () => {
  const { context: c, requests, advance } = await setup();
  const event = { id: "test-event" };
  const full = await c.parlayEventOdds("basketball_nba", event, "fanduel", true, initialTime, "pregame-probability");
  const before = plain(full);
  advance(minute);
  const prop = await c.fetchOddsApi(endpoint, params);
  const guest = await c.parlayEventOdds("basketball_nba", event, "fanduel", false, initialTime, "pregame-probability");
  assert.equal(requests.length, 1);
  assert.equal(prop.oddsFetchedAt, new Date(initialTime).toISOString());
  assert.deepEqual(Array.from(prop.bookmakers[0].markets, market => market.key), ["player_points"]);
  assert.deepEqual(Array.from(guest.data.bookmakers[0].markets, market => market.key), ["player_points", "player_points_alternate"]);
  assert.equal(guest.fetchedAt, full.fetchedAt);
  assert.deepEqual(plain(full), before, "filtering a subset must not mutate the shared response");
});

test("identical live pricing is shared across ranking modes without extending freshness", async () => {
  const { context: c, requests, advance } = await setup({ start: initialTime });
  const event = { id: "test-event" };
  await c.parlayEventOdds("basketball_nba", event, "fanduel", true, initialTime, "live-positive");
  advance(minute - 1);
  await c.parlayEventOdds("basketball_nba", event, "draftkings", true, initialTime, "live-performance");
  assert.equal(requests.length, 1);
  advance(1);
  await c.parlayEventOdds("basketball_nba", event, "fanduel", true, initialTime, "live-performance");
  assert.equal(requests.length, 2);
});

test("concurrent market subsets share an in-flight request with canonical parameter ordering", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { context: c, requests } = await setup({ request: () => gate });
  const full = c.fetchOddsApi(endpoint, { ...params, markets: "player_rebounds,player_points", regions: "us,us2" });
  const identical = c.fetchOddsApi(endpoint.replace(/\/$/, ""), {
    includeLinks: "true", markets: "player_points,player_rebounds,player_points", oddsFormat: "decimal", regions: "us2,us"
  });
  const subset = c.fetchOddsApi(endpoint, { ...params, regions: "us2,us" });
  release();
  const [a, b, small] = await Promise.all([full, identical, subset]);
  assert.equal(requests.length, 1);
  assert.deepEqual(plain(a), plain(b));
  assert.deepEqual(Array.from(small.bookmakers[0].markets, market => market.key), ["player_points"]);
});

test("different games, markets, regions, bookmakers and formats cannot reuse incomplete coverage", async () => {
  const { context: c, requests } = await setup();
  await c.fetchOddsApi(endpoint, params);
  await c.fetchOddsApi(endpoint.replace("test-event", "other-event"), params);
  await c.fetchOddsApi(endpoint, { ...params, markets: "player_points,player_assists" });
  await c.fetchOddsApi(endpoint, { ...params, regions: "uk" });
  await c.fetchOddsApi(endpoint, { ...params, bookmakers: "fanduel" });
  await c.fetchOddsApi(endpoint, { ...params, bookmakers: "draftkings" });
  await c.fetchOddsApi(endpoint, { ...params, oddsFormat: "american" });
  await c.fetchOddsApi(endpoint, { ...params, includeLinks: "false" });
  assert.equal(requests.length, 8);
});

test("a missing market in a populated multi-market cache retries after one minute", async () => {
  const { context: c, requests, advance } = await setup({ missing: ["player_points"] });
  await c.fetchOddsApi(endpoint, { ...params, markets: "player_points,player_assists" });
  const empty = await c.fetchOddsApi(endpoint, params);
  assert.equal(empty.bookmakers.length, 0);
  assert.equal(requests.length, 1);
  advance(minute);
  await c.fetchOddsApi(endpoint, params);
  assert.equal(requests.length, 2, "missing prices must not be hidden for the full pre-game TTL");
});

test("provider failures are propagated and not cached, so a subsequent retry can recover", async () => {
  const failure = Object.assign(new Error("Usage quota has been reached."), { status: 401 });
  const { context: c, requests } = await setup({ request: number => { if (number === 1) throw failure; } });
  const pending = c.fetchOddsApi(endpoint, { ...params, markets: "player_points,player_assists" });
  const subset = c.fetchOddsApi(endpoint, params);
  const results = await Promise.allSettled([pending, subset]);
  assert.ok(results.every(result => result.status === "rejected" && result.reason === failure));
  const recovered = await c.fetchOddsApi(endpoint, params);
  assert.equal(requests.length, 2);
  assert.equal(recovered.bookmakers.length, 1);
});

test("free sports and event listings retain their existing cache behavior and response shape", async () => {
  const { context: c, requests, advance } = await setup();
  c.requestOddsApi = async path => { requests.push(path); return [{ id: "test-event" }]; };
  const first = await c.fetchOddsApi("sports/");
  await c.fetchOddsApi("sports/");
  advance(minute);
  await c.fetchOddsApi("sports/");
  assert.equal(requests.length, 1);
  assert.deepEqual(plain(first), [{ id: "test-event" }]);
  await c.fetchOddsApi("sports/basketball_nba/events/");
  await c.fetchOddsApi("sports/basketball_nba/events/");
  assert.equal(requests.length, 2);
  advance(minute);
  await c.fetchOddsApi("sports/basketball_nba/events/");
  assert.equal(requests.length, 3);
});

test("SportsDataIO requests use the same event-odds cache and response timestamp", async () => {
  const { context: c } = await setup({ oddsProvider: "sportsdataio" });
  const requests = [];
  c.sportsDataIO.request = async (path, parameters) => {
    requests.push({ path, parameters });
    if (path.endsWith("/events/")) return [{ id: "test-event" }];
    return {
      id: "test-event",
      commence_time: new Date(initialTime + 3 * 60 * minute).toISOString(),
      bookmakers: [{ key: "fanduel", markets: [{ key: "player_points", outcomes: [
        { name: "Over", description: "Test Player", point: 20.5, price: 1.9 }
      ] }] }]
    };
  };
  const events = await c.fetchOddsApi("sports/basketball_nba/events/", {});
  const odds = await c.fetchOddsApi(endpoint, params);
  const parlay = await c.parlayEventOdds("basketball_nba", { id: "test-event" }, "fanduel", true, initialTime);
  assert.deepEqual(plain(events), [{ id: "test-event" }]);
  assert.equal(odds.bookmakers[0].key, "fanduel");
  assert.equal(odds.oddsFetchedAt, new Date(initialTime).toISOString());
  assert.equal(parlay.data.bookmakers[0].key, "fanduel");
  assert.equal(requests.length, 3);
  assert.equal(requests[1].path, endpoint.replace(/\/$/, ""));
  assert.equal(requests[2].path, endpoint.replace(/\/$/, ""));
});
