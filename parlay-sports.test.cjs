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
  const options = { children: [], append(node) { this.children.push(node); },
    querySelectorAll() { return this.children.map(label => label.children[0]); } };
  const context = {
    settings, supportedSports, soccerSupport, isSoccer: soccerSupport.isSoccer,
    playerPropSports: {}, bpSportSelect: { querySelector: () => options },
    document: { createElement: () => ({ dataset: {} }), createTextNode: value => value },
    element: () => ({ children: [], append(...nodes) { this.children.push(...nodes); } }),
    saves: 0, loads: 0, saveSettings() { this.saves++; }, loadBestParlay() { this.loads++; }
  };
  // VM calls have no receiver, so count through closures.
  context.saveSettings = () => context.saves++;
  context.loadBestParlay = () => context.loads++;
  runInNewContext(slice(html, "    function bestParlaySport(", "    function bestParlaySide(") +
    slice(html, "    function fillBestParlaySportCheckboxes(", "    async function loadBestParlay("), context);
  return { context, options };
}

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
