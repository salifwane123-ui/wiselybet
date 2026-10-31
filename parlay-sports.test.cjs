const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");
const soccerSupport = require("./soccer.js");
const html = readFileSync("index.html", "utf8");
const server = readFileSync("server.mjs", "utf8");
const slice = (text, start, end) => {
  const from = text.indexOf(start), to = text.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return text.slice(from, to);
};
const supportedSports = ["basketball_nba", "icehockey_nhl", "basketball_wnba", ...Object.keys(soccerSupport.leagues)];
function setup(settings = {}) {
  const toggle = { textContent: "", attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } };
  const options = { children: [], append(node) { this.children.push(node); },
    querySelectorAll() { return this.children.map(label => label.children[0]); } };
  const context = {
    settings, supportedSports, soccerSupport, isSoccer: soccerSupport.isSoccer,
    playerPropSports: {}, bpSportSelect: { querySelector: () => options },
    document: { createElement: () => ({ dataset: {} }), createTextNode: value => value,
      getElementById: () => toggle },
    element: () => ({ children: [], append(...nodes) { this.children.push(...nodes); } }),
    saves: 0, loads: 0, saveSettings() { this.saves++; }, loadBestParlay() { this.loads++; }
  };
  // VM calls have no receiver, so count through closures.
  context.saveSettings = () => context.saves++;
  context.loadBestParlay = () => context.loads++;
  runInNewContext(slice(html, "    function bestParlaySport(", "    function bestParlaySide(") +
    slice(html, "    function fillBestParlaySportCheckboxes(", "    async function loadBestParlay("), context);
  return { context, options, toggle };
}

test("compact dropdown summarizes selection while retaining native outside-click and Escape dismissal", () => {
  const { context: c, toggle } = setup();
  c.fillBestParlaySportCheckboxes();
  assert.equal(toggle.textContent, "All sports");
  c.settings.parlaySports = ["basketball_nba", "icehockey_nhl"];
  c.fillBestParlaySportCheckboxes();
  assert.equal(toggle.textContent, "2 sports");
  c.settings.parlaySports = [];
  c.fillBestParlaySportCheckboxes();
  assert.equal(toggle.textContent, "Select sports");
  assert.ok(html.includes('popovertarget="bp-sport-select"'));
  assert.ok(html.includes('class="bp-sport-select" popover'));
});

test("legacy sport preferences migrate without overriding an explicit empty selection", () => {
  assert.equal(setup({ parlaySport: "basketball_nba" }).context.bestParlaySport(), "basketball_nba");
  assert.equal(setup({ parlaySport: "all" }).context.bestParlaySport(), "all");
  assert.equal(setup({ parlaySports: [] }).context.bestParlaySport(), "");
  assert.equal(setup({ parlaySports: ["icehockey_nhl", "basketball_nba", "invalid"] }).context.bestParlaySport(), "basketball_nba,icehockey_nhl");
  assert.ok(!setup().context.bestParlaySports().includes("soccer_uefa_champs_league"));
});

test("checkboxes enable any combination, all toggles every sport, and partial selection is indeterminate", () => {
  const { context: c, options } = setup();
  c.fillBestParlaySportCheckboxes();
  const boxes = options.querySelectorAll();
  const all = boxes.find(box => box.dataset.sport === "all");
  assert.equal(all.checked, true);
  const nba = boxes.find(box => box.dataset.sport === "basketball_nba");
  nba.checked = false;
  c.changeBestParlaySports(nba);
  assert.equal(all.checked, false);
  assert.equal(all.indeterminate, true);
  assert.ok(!c.bestParlaySports().includes("basketball_nba"));
  assert.equal(c.saves, 1);
  assert.equal(c.loads, 1);
  all.checked = false;
  c.changeBestParlaySports(all);
  assert.equal(c.bestParlaySport(), "");
  assert.equal(all.indeterminate, false);
  all.checked = true;
  c.changeBestParlaySports(all);
  assert.equal(c.bestParlaySport(), "all");
  const unavailable = boxes.find(box => box.dataset.sport === "soccer_uefa_champs_league");
  assert.equal(unavailable.disabled, true);
  assert.equal(unavailable.checked, false);
  const original = options.children[0];
  c.fillBestParlaySportCheckboxes();
  assert.equal(options.children[0], original, "refresh preserves focused checkbox DOM");
});

test("empty selection pauses network requests and invalidates in-flight results", async () => {
  const { context: c } = setup({ parlaySports: [] });
  Object.assign(c, { bestParlayElement: {}, embedMode: false, bestParlayState: { sport: "all", request: 1, data: { legs: [] } },
    bestParlaySide: () => "all", bestParlayBook: () => "fanduel", renderBestParlay() {}, getJson() { throw new Error("Should not fetch"); } });
  runInNewContext(slice(html, "    async function loadBestParlay(", "    function refreshBestParlayIfOld("), c);
  await c.loadBestParlay();
  assert.equal(c.bestParlayState.loading, false);
  assert.equal(c.bestParlayState.request, 2);
  assert.equal(c.bestParlayState.data, null);
  assert.ok(html.includes('bestParlayMessage("Select at least one sport"'));
});

test("multiple checked sports reach the API as the exact selected subset", async () => {
  const { context: c } = setup({ parlaySports: ["icehockey_nhl", "basketball_nba"] });
  const paths = [];
  Object.assign(c, { bestParlayElement: {}, embedMode: false, bestParlayState: { request: 0 },
    bestParlaySide: () => "under", bestParlayBook: () => "fanduel", renderBestParlay() {},
    getJson: async path => { paths.push(path); return { legs: [], sport: "basketball_nba,icehockey_nhl" }; } });
  runInNewContext(slice(html, "    async function loadBestParlay(", "    function refreshBestParlayIfOld("), c);
  await c.loadBestParlay();
  const url = new URL(paths[0], "https://example.com");
  assert.equal(url.searchParams.get("sport"), "all");
  assert.equal(url.searchParams.get("sports"), "basketball_nba,icehockey_nhl");
  assert.equal(url.searchParams.get("side"), "under");
  assert.equal(c.bestParlayState.data.sport, c.bestParlaySport());
});

test("subset requests use canonical selected-sport signatures and only the selected providers", async () => {
  const calls = [], cache = new Map();
  const c = { bestParlayMarkets: { icehockey_nhl: [], basketball_nba: [], baseball_mlb: [] },
    parlayLastGood: new Map(), parlayStaleMs: 1000, cachedValue: key => cache.get(key),
    cached: async (key, ttl, fn) => { const value = await fn(); cache.set(key, value); return value; },
    bestParlayFor: async sport => { calls.push(sport); return { sport, legs: [], alternates: [], injuryCheck: true }; },
    combineBestParlays: () => ({ legs: [], alternates: [] }), console };
  runInNewContext(slice(server, "async function bestParlayForAllSports(", "const rateWindowMs"), c);
  const selected = ["basketball_nba", "icehockey_nhl"];
  const result = await c.bestParlayForAllSports("fanduel", true, "all", "lowest-line", selected);
  assert.deepEqual(calls.sort(), selected);
  assert.equal(result.sport, "basketball_nba,icehockey_nhl");
  await c.bestParlayForAllSports("fanduel", true, "all", "lowest-line", [...selected].reverse());
  assert.equal(calls.length, 2, "selection order shares canonical cache");
  await c.bestParlayForAllSports("fanduel", true, "all", "lowest-line", ["baseball_mlb"]);
  assert.equal(calls[2], "baseball_mlb");
});

test("live-positive server response never fetches upcoming prices or falls back when fewer than two live legs qualify", async () => {
  const calls = [];
  const events = [{ id: "live", live: true }, { id: "upcoming", live: false }];
  const c = {
    parlayRules: { maxGames: 8, minLiveLegs: 2 }, bestParlayMarkets: { basketball_nba: ["player_points"] },
    cached: async (key, ttl, fn) => fn(), fetchPlayerInjuries: async () => [], injuredPlayers: () => new Set(),
    fetchOddsApi: async () => events, selectSlate: list => ({ events: list }),
    parlayLiveGame: async () => ({ state: "in" }),
    parlayEventOdds: async (sport, event) => { calls.push(event.id); return {}; },
    buildBestParlay: () => ({ legs: [{ player: "Sample", live: true, price: 2 }], alternates: [], bookGames: 1 }),
    console
  };
  runInNewContext(slice(server, "async function buildParlayResponse(", "const easternDates"), c);
  const result = await c.buildParlayResponse("basketball_nba", "fanduel", true, { rankBy: "live-positive" });
  assert.deepEqual(calls, ["live"]);
  assert.equal(result.scope, "live");
  assert.equal(result.legs.length, 1, "cross-sport aggregation can combine single qualifying legs");
  c.parlayLiveGame = async () => ({ state: "post" });
  calls.length = 0;
  const empty = await c.buildParlayResponse("basketball_nba", "fanduel", true, { rankBy: "live-positive" });
  assert.equal(empty.legs.length, 0);
  assert.equal(calls.length, 0);
});

test("client pauses a live-positive parlay below two eligible legs, including after a player is removed", () => {
  const c = { parlayLegTarget: () => 8, bestParlayPool: data => data.legs, isBestParlayRemoved: leg => leg.removed,
    liveLegRead: leg => leg.read };
  runInNewContext(slice(html, "    function bestParlayLegsFor(", "    function bestParlayOutcomeText("), c);
  const leg = { live: true, price: 2, read: { clock: "Q2" } };
  const data = { rankBy: "live-positive", legs: [leg, { ...leg, price: 2.1 }, { ...leg, price: 1.9 }, { ...leg, live: false }] };
  assert.equal(c.bestParlayLegsFor(data).legs.length, 2);
  data.legs[1].removed = true;
  assert.equal(c.bestParlayLegsFor(data).legs.length, 0);
});

test("live-positive requests never return last-good fallback on provider failure or low quota", async () => {
  const c = {
    parlayRules: { maxGames: 8 }, parlayLastGood: new Map(), parlayStaleMs: 30 * 60_000,
    cachedValue: () => null, oddsQuotaLow: () => false,
    cached: async () => { throw new Error("Provider offline"); },
    console: { error() {} }
  };
  runInNewContext(slice(server, "async function bestParlayFor(", "async function bestParlayForAllSports("), c);
  const key = "best-parlay:basketball_nba|fanduel|full|8|plain|all|live-positive";
  c.parlayLastGood.set(key, { generatedAt: new Date().toISOString(), scope: "live", legs: [{ price: 2 }] });
  await assert.rejects(c.bestParlayFor("basketball_nba", "fanduel", true, { rankBy: "live-positive" }), error => error.status === 503);
  c.oddsQuotaLow = () => true;
  await assert.rejects(c.bestParlayFor("basketball_nba", "fanduel", true, { rankBy: "live-positive" }), error => error.status === 503);
});

test("one qualifying live leg from each selected sport forms a cross-sport parlay", async () => {
  const seen = [];
  const c = {
    bestParlayMarkets: { basketball_nba: [], icehockey_nhl: [], baseball_mlb: [] },
    parlayLastGood: new Map(), cachedValue: () => null, cached: async (key, ttl, fn) => fn(),
    bestParlayFor: async (sport, book, premium, options) => {
      seen.push({ sport, rankBy: options.rankBy });
      return { sport, scope: "live", legs: [{ player: sport, price: 2, live: true, probability: 0.48 }], alternates: [] };
    },
    combineBestParlays: results => ({ legs: results.flatMap(result => result.legs), alternates: [] }),
    console
  };
  runInNewContext(slice(server, "async function bestParlayForAllSports(", "const rateWindowMs"), c);
  const result = await c.bestParlayForAllSports("fanduel", true, "all", "live-positive", ["basketball_nba", "icehockey_nhl"]);
  assert.equal(result.legs.length, 2);
  assert.equal(result.scope, "live");
  assert.deepEqual(seen, [{ sport: "basketball_nba", rankBy: "live-positive" }, { sport: "icehockey_nhl", rankBy: "live-positive" }]);
});

test("a failed refresh clears previous live suggestions", async () => {
  const c = {
    bestParlayElement: {}, embedMode: false,
    bestParlayState: { sport: "basketball_nba", side: "all", book: "fanduel", request: 0, data: { legs: [{ price: 2 }] } },
    bestParlaySport: () => "basketball_nba", bestParlaySide: () => "all", bestParlayBook: () => "fanduel",
    renderBestParlay() {}, getJson: async () => { throw new Error("Feed unavailable"); }
  };
  runInNewContext(slice(html, "    async function loadBestParlay(", "    function refreshBestParlayIfOld("), c);
  await c.loadBestParlay();
  assert.equal(c.bestParlayState.data, null);
  assert.equal(c.bestParlayState.error, "Feed unavailable");
});
