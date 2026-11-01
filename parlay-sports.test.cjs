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

test("explicit game filters use only the chosen slate and Both merges live with upcoming", async () => {
  const calls = [];
  const events = [{ id: "live", live: true }, { id: "future", commence_time: new Date(Date.now() + 3600000).toISOString() }];
  const c = {
    parlayRules: { maxGames: 8, minLiveLegs: 2 }, bestParlayMarkets: { basketball_nba: ["player_points"] },
    cached: async (key, ttl, fn) => fn(), fetchPlayerInjuries: async () => [], injuredPlayers: () => new Set(),
    fetchOddsApi: async () => events, selectSlate: list => ({ scope: "soon", events: list }),
    parlayLiveGame: async () => ({ state: "in" }),
    parlayEventOdds: async (sport, event) => { calls.push(event.id); return {}; },
    buildBestParlay: options => ({ legs: [{ player: options.events[0]?.id, live: options.rankBy === "live-performance",
      price: 1.8, probability: 0.6, _rank: 0.6 }].filter(leg => leg.player), alternates: [], bookGames: 1, injuredSkipped: 0 }),
    combineBestParlays: results => ({ legs: results.flatMap(result => result.legs), alternates: [] }), console
  };
  runInNewContext(slice(server, "async function buildParlayResponse(", "const easternDates"), c);
  for (const filter of ["live", "upcoming", "both"]) {
    calls.length = 0;
    const result = await c.buildParlayResponse("basketball_nba", "fanduel", true, { rankBy: "live-performance", gameFilter: filter });
    assert.equal(result.gameFilter, filter);
    assert.deepEqual(calls, filter === "both" ? ["live", "future"] : filter === "live" ? ["live"] : ["future"]);
    assert.equal(result.legs.length, filter === "both" ? 2 : 1);
    if (filter === "both") assert.equal(result.scope, "mixed");
  }
});

test("game preference defaults to Live and changes the request while invalidating old data", async () => {
  const c = { settings: {} };
  runInNewContext(slice(html, "    function bestParlayGames(", "    function bestParlayBook("), c);
  assert.equal(c.bestParlayGames(), "live");
  c.settings.parlayGames = "both";
  assert.equal(c.bestParlayGames(), "both");
  const paths = [];
  Object.assign(c, { bestParlayElement: {}, embedMode: false, bestParlayState: { games: "live", request: 0, data: { legs: [] } },
    bestParlaySport: () => "basketball_nba", bestParlaySide: () => "all", bestParlayBook: () => "fanduel",
    renderBestParlay() {}, getJson: async path => { paths.push(path); assert.equal(c.bestParlayState.data, null); return { legs: [], gameFilter: "both" }; } });
  runInNewContext(slice(html, "    async function loadBestParlay(", "    function refreshBestParlayIfOld("), c);
  await c.loadBestParlay();
  assert.equal(new URL(paths[0], "https://example.com").searchParams.get("games"), "both");
  assert.equal(c.bestParlayState.games, "both");
});

test("client selected game mode gates all legs and replacements and pauses below two", () => {
  const c = { parlayLegTarget: () => 8, bestParlayPool: data => [...data.legs, ...(data.alternates || [])],
    isBestParlayRemoved: () => false, liveLegRead: leg => leg.read };
  runInNewContext(slice(html, "    function bestParlayLegsFor(", "    function bestParlayOutcomeText("), c);
  const legs = [{ live: true, price: 2, read: {} }, { live: false, price: 1.8 }, { live: true, price: 2 }];
  assert.equal(c.bestParlayLegsFor({ gameFilter: "both", rankBy: "mixed-performance", legs }).legs.length, 2);
  assert.equal(c.bestParlayLegsFor({ gameFilter: "live", rankBy: "live-performance", legs }).legs.length, 0);
  assert.equal(c.bestParlayLegsFor({ gameFilter: "upcoming", rankBy: "pregame-probability", legs, alternates: [{ live: false, price: 1.9 }] }).legs.length, 2);
});

test("phase-specific single and cross-sport caches cannot reuse another mode", async () => {
  const keys = [];
  const c = {
    parlayRules: { maxGames: 8 }, bestParlayMarkets: { basketball_nba: [], icehockey_nhl: [] },
    parlayLastGood: new Map(), cachedValue: key => { keys.push(key); return null; }, oddsQuotaLow: () => false,
    cached: async (key, ttl, fn) => fn(),
    buildParlayResponse: async (sport, book, premium, options) => ({ sport, gameFilter: options.gameFilter,
      legs: [{ player: sport, live: options.gameFilter === "live", probability: 0.6 }], alternates: [] }),
    combineBestParlays: results => ({ legs: results.flatMap(result => result.legs), alternates: [] }), console
  };
  runInNewContext(slice(server, "async function bestParlayFor(", "const rateWindowMs"), c);
  for (const filter of ["live", "upcoming", "both"]) {
    const single = await c.bestParlayFor("basketball_nba", "fanduel", true, { rankBy: "live-performance", gameFilter: filter });
    assert.equal(single.gameFilter, filter);
    const all = await c.bestParlayForAllSports("fanduel", true, "all", "live-performance", ["basketball_nba", "icehockey_nhl"], filter);
    assert.equal(all.gameFilter, filter);
    assert.equal(all.legs.length, 2);
  }
  assert.equal(new Set(keys).size, 12);
  assert.ok(keys.every(key => /\|games:(live|upcoming|both)$/.test(key)));
});
function setup(settings = {}) {
  const toggle = { textContent: "", attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } };
  const options = { children: [], append(node) { this.children.push(node); },
    querySelectorAll() { return this.children.map(label => label.children[0]); } };
  const context = {
    settings, supportedSports, soccerSupport, isSoccer: soccerSupport.isSoccer, bestParlayGames: () => "live",
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

test("live-performance keeps a live parlay off upcoming prices and swaps short live picks only for a full pre-game parlay", async () => {
  const now = Date.now();
  const calls = [];
  const events = [{ id: "live", live: true }, { id: "upcoming", commence_time: new Date(now + 3600_000).toISOString() }];
  let liveCount = 2, pregameCount = 2, pricesDown = false;
  const legs = (count, live) => Array.from({ length: count }, (_, index) => ({ player: `${live ? "Live" : "Pre"} ${index}`, live, price: 1.8 }));
  const c = {
    parlayRules: { maxGames: 8, minLiveLegs: 2 }, bestParlayMarkets: { basketball_nba: ["player_points"] },
    cached: async (key, ttl, fn) => fn(), fetchPlayerInjuries: async () => [], injuredPlayers: () => new Set(),
    fetchOddsApi: async () => events, selectSlate: list => ({ scope: "soon", events: list }),
    parlayLiveGame: async () => ({ state: "in" }),
    parlayEventOdds: async (sport, event) => {
      calls.push(event.id);
      if (pricesDown && event.id === "upcoming") throw new Error("odds feed down");
      return {};
    },
    buildBestParlay: options => ({ legs: options.rankBy === "live-performance" ? legs(liveCount, true) : legs(pregameCount, false), alternates: [], bookGames: 1 }),
    console
  };
  runInNewContext(slice(server, "async function buildParlayResponse(", "const easternDates"), c);
  const run = () => c.buildParlayResponse("basketball_nba", "fanduel", true, { rankBy: "live-performance" });

  const live = await run();
  assert.equal(live.rankBy, "live-performance");
  assert.equal(live.scope, "live");
  assert.equal(live.legs.length, 2);
  assert.deepEqual(calls, ["live"], "a live parlay never prices the upcoming games");

  liveCount = 1;
  calls.length = 0;
  const pregame = await run();
  assert.equal(pregame.rankBy, "pregame-probability");
  assert.equal(pregame.scope, "soon");
  assert.deepEqual(Array.from(pregame.legs, leg => leg.player), ["Pre 0", "Pre 1"]);
  assert.equal(pregame.live.games, 1);
  assert.equal(pregame.live.legs, 1);
  assert.deepEqual(Array.from(pregame.liveLegs, leg => leg.player), ["Live 0"], "the lone live pick stays available to a cross-sport parlay");
  assert.deepEqual(calls, ["live", "upcoming"]);

  liveCount = 0;
  pregameCount = 1;
  const short = await run();
  assert.equal(short.rankBy, "live-performance", "pre-game picks that can't fill a parlay leave the live answer");
  assert.equal(short.legs.length, 0);
  assert.equal(short.liveLegs, undefined);

  liveCount = 1;
  pregameCount = 2;
  pricesDown = true;
  const down = await run();
  assert.equal(down.rankBy, "live-performance", "a failed pre-game fallback keeps the live answer");
  assert.equal(down.legs.length, 1, "cross-sport aggregation can combine single qualifying legs");
});

test("with no game live, live-performance falls back to the upcoming slate ranked by pre-game probability", async () => {
  const now = Date.now();
  const calls = [], builds = [];
  const events = [
    { id: "started", commence_time: new Date(now - 3 * 3600_000).toISOString() },
    { id: "tonight", commence_time: new Date(now + 3600_000).toISOString() }
  ];
  let state = "post";
  const c = {
    parlayRules: { maxGames: 8, minLiveLegs: 2 }, bestParlayMarkets: { basketball_nba: ["player_points"] },
    cached: async (key, ttl, fn) => fn(), fetchPlayerInjuries: async () => [], injuredPlayers: () => new Set(),
    fetchOddsApi: async () => events,
    selectSlate: (list, at) => ({ scope: "soon", events: list.map(event => ({ ...event, live: Date.parse(event.commence_time) <= at })) }),
    parlayLiveGame: async () => ({ state }),
    parlayEventOdds: async (sport, event, book, premium, at, rankBy) => { calls.push([event.id, rankBy]); return {}; },
    buildBestParlay: options => { builds.push(options.rankBy); return { legs: [{ player: "Sample", live: false, price: 1.5 }], alternates: [], bookGames: 1 }; },
    console
  };
  runInNewContext(slice(server, "async function buildParlayResponse(", "const easternDates"), c);
  const pregame = await c.buildParlayResponse("basketball_nba", "fanduel", true, { rankBy: "live-performance" });
  assert.equal(pregame.rankBy, "pregame-probability");
  assert.equal(pregame.scope, "soon");
  assert.equal(pregame.legs.length, 1);
  assert.deepEqual(calls, [["tonight", "pregame-probability"]]);
  assert.deepEqual(builds, ["pregame-probability"]);

  state = "in";
  calls.length = 0;
  builds.length = 0;
  c.buildBestParlay = options => { builds.push(options.rankBy); return { legs: [], alternates: [], bookGames: 1 }; };
  const live = await c.buildParlayResponse("basketball_nba", "fanduel", true, { rankBy: "live-performance" });
  assert.equal(live.rankBy, "live-performance", "with a game on and no pre-game parlay either, the live answer stands");
  assert.equal(live.scope, "live");
  assert.equal(live.legs.length, 0);
  assert.deepEqual(calls, [["started", "live-performance"], ["tonight", "pregame-probability"]]);
  assert.deepEqual(builds, ["live-performance", "pregame-probability"]);
});

test("cross-sport pre-game picks fill in whenever the selected sports' live picks can't form a parlay", async () => {
  const picks = (prefix, sport, count, live) => Array.from({ length: count }, (_, index) => ({ player: `${prefix} ${sport} ${index}`, price: live ? 2 : 1.4, live }));
  const pre = (sport, count = 1, extra = {}) => ({ sport, rankBy: "pregame-probability", scope: "soon", games: 2, legs: picks("Pre", sport, count, false), alternates: [], ...extra });
  const on = (sport, count) => ({ sport, rankBy: "live-performance", scope: "live", games: 1, live: { games: 1, bookGames: 1 }, legs: picks("Live", sport, count, true), alternates: [] });
  const answers = { basketball_nba: pre("basketball_nba"), icehockey_nhl: pre("icehockey_nhl") };
  const c = {
    parlayRules: { minLiveLegs: 2 }, bestParlayMarkets: { basketball_nba: [], icehockey_nhl: [] },
    parlayLastGood: new Map(), cachedValue: () => null, cached: async (key, ttl, fn) => fn(),
    bestParlayFor: async sport => answers[sport],
    combineBestParlays: results => ({ legs: results.flatMap(result => result.legs), alternates: [] }),
    console
  };
  runInNewContext(slice(server, "async function bestParlayForAllSports(", "const rateWindowMs"), c);
  const run = () => c.bestParlayForAllSports("fanduel", true, "all", "live-performance", ["basketball_nba", "icehockey_nhl"]);
  const players = result => Array.from(result.legs, leg => leg.player);

  let result = await run();
  assert.equal(result.rankBy, "pregame-probability");
  assert.equal(result.scope, "soon");
  assert.deepEqual(players(result), ["Pre basketball_nba 0", "Pre icehockey_nhl 0"]);

  answers.basketball_nba = on("basketball_nba", 2);
  result = await run();
  assert.equal(result.rankBy, "live-performance");
  assert.equal(result.scope, "live");
  assert.deepEqual(players(result), ["Live basketball_nba 0", "Live basketball_nba 1"], "a live parlay keeps pre-game picks out");
  assert.equal(result.games, 1);

  answers.basketball_nba = on("basketball_nba", 1);
  answers.icehockey_nhl = pre("icehockey_nhl", 2);
  result = await run();
  assert.equal(result.rankBy, "pregame-probability", "one live pick can't form a parlay, so pre-game picks fill in");
  assert.deepEqual(players(result), ["Pre icehockey_nhl 0", "Pre icehockey_nhl 1"]);
  assert.equal(result.live.games, 1);

  answers.icehockey_nhl = pre("icehockey_nhl", 2, { live: { games: 2, bookGames: 1 }, liveLegs: picks("Live", "icehockey_nhl", 1, true) });
  result = await run();
  assert.equal(result.rankBy, "live-performance", "a sport's lone live pick still pairs with another sport's");
  assert.deepEqual(players(result), ["Live basketball_nba 0", "Live icehockey_nhl 0"]);
  assert.equal(result.games, 3);

  answers.basketball_nba = on("basketball_nba", 0);
  answers.icehockey_nhl = pre("icehockey_nhl", 1);
  result = await run();
  assert.equal(result.rankBy, "live-performance", "with games on and no full pre-game parlay, the live answer stands");
  assert.equal(result.legs.length, 0);
});

test("client shows pre-game fallback legs without a live read and explains an empty fallback", () => {
  const c = { parlayLegTarget: () => 8, bestParlayPool: data => data.legs, isBestParlayRemoved: leg => leg.removed,
    liveLegRead: leg => leg.read };
  runInNewContext(slice(html, "    function bestParlayLegsFor(", "    function bestParlayOutcomeText("), c);
  const leg = { live: false, price: 1.4, probability: 0.7 };
  assert.equal(c.bestParlayLegsFor({ rankBy: "pregame-probability", legs: [leg, { ...leg, price: 1.6 }] }).legs.length, 2);
  assert.equal(c.bestParlayLegsFor({ rankBy: "live-performance", legs: [leg, { ...leg, price: 1.6 }] }).legs.length, 0);
  const e = { sportsbookTitle: () => "FanDuel", bestParlayMessage: (title, text) => ({ title, text }), bestParlayState: {},
    countText: (count, word) => `${count} ${word}`, liveSkipText: () => "" };
  runInNewContext(slice(html, "    function bestParlayEmptySlide(", "    function bestParlayAllRemovedSlide("), e);
  const empty = e.bestParlayEmptySlide({ rankBy: "pregame-probability", sport: "basketball_nba", legs: [], games: 3, bookGames: 3 }, "fanduel");
  assert.match(empty.title, /pre-game/i);
  assert.match(empty.text, /No game is live/);
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

test("live-performance requests never return last-good fallback on provider failure or low quota", async () => {
  const c = {
    parlayRules: { maxGames: 8 }, parlayLastGood: new Map(), parlayStaleMs: 30 * 60_000,
    cachedValue: () => null, oddsQuotaLow: () => false,
    cached: async () => { throw new Error("Provider offline"); },
    console: { error() {} }
  };
  runInNewContext(slice(server, "async function bestParlayFor(", "async function bestParlayForAllSports("), c);
  const key = "best-parlay:basketball_nba|fanduel|full|8|plain|all|live-performance";
  c.parlayLastGood.set(key, { generatedAt: new Date().toISOString(), scope: "live", legs: [{ price: 2 }] });
  await assert.rejects(c.bestParlayFor("basketball_nba", "fanduel", true, { rankBy: "live-performance" }), error => error.status === 503);
  c.oddsQuotaLow = () => true;
  await assert.rejects(c.bestParlayFor("basketball_nba", "fanduel", true, { rankBy: "live-performance" }), error => error.status === 503);
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
  const result = await c.bestParlayForAllSports("fanduel", true, "all", "live-performance", ["basketball_nba", "icehockey_nhl"]);
  assert.equal(result.legs.length, 2);
  assert.equal(result.scope, "live");
  assert.deepEqual(seen, [{ sport: "basketball_nba", rankBy: "live-performance" }, { sport: "icehockey_nhl", rankBy: "live-performance" }]);
});

test("a failed refresh clears previous live suggestions", async () => {
  const c = {
    bestParlayElement: {}, embedMode: false,
    bestParlayState: { sport: "basketball_nba", side: "all", book: "fanduel", request: 0, data: { legs: [{ price: 2 }] } },
    bestParlaySport: () => "basketball_nba", bestParlaySide: () => "all", bestParlayBook: () => "fanduel", bestParlayGames: () => "live",
    renderBestParlay() {}, getJson: async () => { throw new Error("Feed unavailable"); }
  };
  runInNewContext(slice(html, "    async function loadBestParlay(", "    function refreshBestParlayIfOld("), c);
  await c.loadBestParlay();
  assert.equal(c.bestParlayState.data, null);
  assert.equal(c.bestParlayState.error, "Feed unavailable");
});

test("live-performance client accepts both odds signs but still pauses below two eligible live picks", () => {
  const c = { parlayLegTarget: () => 8, bestParlayPool: data => data.legs, isBestParlayRemoved: leg => leg.removed,
    liveLegRead: leg => leg.read };
  runInNewContext(slice(html, "    function bestParlayLegsFor(", "    function bestParlayOutcomeText("), c);
  const leg = { live: true, price: 1.5, read: { clock: "Q2" } };
  const data = { rankBy: "live-performance", legs: [leg, { ...leg, price: 3 }, { ...leg, price: 1 }, { ...leg, live: false }] };
  assert.equal(c.bestParlayLegsFor(data).legs.length, 2);
  data.legs[1].removed = true;
  assert.equal(c.bestParlayLegsFor(data).legs.length, 0);
  assert.ok(server.includes('bestParlayForAllSports(book, premium, sideFilter, "live-performance", selectedSports, gameFilter)'));
  assert.ok(server.includes('bestParlayFor(sport, book, premium, { sideFilter, rankBy: "live-performance", gameFilter })'));
});
