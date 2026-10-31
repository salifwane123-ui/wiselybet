const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");
const moneylineSupport = require("./moneyline.js");
const soccerSupport = require("./soccer.js");
const event = { id: "match1", home_team: "Home Team", away_team: "Away Team", commence_time: "2026-10-31T18:00:00Z" };
const pick = (sport = "basketball_nba", selection = "home") => ({
  key: `${sport}-${selection}`, stat: "ML", target: 1, sport, selection,
  name: selection === "draw" ? "Draw" : event[`${selection}_team`],
  home: event.home_team, away: event.away_team, eventId: event.id, date: event.commence_time
});
const game = (sport, homeScore, awayScore, state = "in", extra = {}) => ({
  sport, state, period: 2, periodLabel: state === "post" ? "Final" : "Live",
  teams: [{ name: "Away Team", homeAway: "away", score: awayScore, players: [] },
    { name: "Home Team", homeAway: "home", score: homeScore, players: [] }], ...extra
});

test("moneyline settles only at final across every supported sport", () => {
  for (const sport of ["basketball_nba", "basketball_wnba", "icehockey_nhl", "baseball_mlb",
    "americanfootball_nfl", "americanfootball_ncaaf", ...Object.keys(soccerSupport.leagues)]) {
    const tracker = pick(sport);
    const live = moneylineSupport.snapshot(tracker, game(sport, "3", "1"));
    assert.equal(live.outcome, "live");
    assert.equal(live.current, 0);
    assert.equal(live.position, "Leading");
    assert.equal(moneylineSupport.snapshot(tracker, game(sport, 3, 1, "post")).outcome, "won");
    assert.equal(moneylineSupport.snapshot(tracker, game(sport, 1, 3, "post")).outcome, "lost");
    assert.equal(moneylineSupport.snapshot(pick(sport, "away"), game(sport, 1, 3, "post")).outcome, "won");
  }
});

test("soccer draws win only at full time; team moneylines lose a draw; other tied finals have no action", () => {
  const sport = "soccer_epl";
  assert.equal(moneylineSupport.snapshot(pick(sport, "draw"), game(sport, 0, 0)).outcome, "live");
  assert.equal(moneylineSupport.snapshot(pick(sport, "draw"), game(sport, 0, 0, "post")).outcome, "won");
  assert.equal(moneylineSupport.snapshot(pick(sport, "draw"), game(sport, 1, 0, "post")).outcome, "lost");
  assert.equal(moneylineSupport.snapshot(pick(sport), game(sport, 0, 0, "post")).outcome, "lost");
  assert.equal(moneylineSupport.snapshot(pick("americanfootball_nfl"), game("americanfootball_nfl", 20, 20, "post")).outcome, "void");
  assert.equal(moneylineSupport.snapshot(pick(), game("basketball_nba", 101, 100, "post", { period: 5 })).outcome, "won");
});

test("bad scores, wrong teams, interrupted matches and extra time never produce a false result", () => {
  for (const value of [null, undefined, "", "TBD", NaN, -1]) {
    const snapshot = moneylineSupport.snapshot(pick(), game("basketball_nba", value, 1, "post"));
    assert.ok(snapshot.error);
    assert.equal(snapshot.outcome, "live");
  }
  const tracker = pick("soccer_uefa_champs_league");
  for (const extra of [{ period: 3 }, { periodLabel: "Final (AET)" }, { periodLabel: "Final on penalties" }, { periodLabel: "Abandoned" }]) {
    const snapshot = moneylineSupport.snapshot(tracker, game(tracker.sport, 2, 1, "post", extra));
    assert.ok(snapshot.error);
    assert.equal(snapshot.outcome, "live");
  }
  assert.ok(moneylineSupport.snapshot(pick(), { ...game("basketball_nba", 1, 0), teams: [] }).error);
  const missingScore = game("basketball_nba", 0, 0, "post");
  missingScore.teams[0].scoreVerified = false;
  assert.ok(moneylineSupport.snapshot(pick(), missingScore).error);
  assert.equal(moneylineSupport.selection("Man Utd", { home_team: "Manchester United", away_team: "Newcastle United" }, "soccer_epl"), "home");
  assert.equal(moneylineSupport.selection("United", { home_team: "Manchester United", away_team: "Newcastle United" }, "soccer_epl"), "");
  assert.equal(moneylineSupport.selection("Draw", event, "basketball_nba"), "");
});

const html = readFileSync("index.html", "utf8");
function slice(start, end) {
  const from = html.indexOf(start), to = html.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return html.slice(from, to);
}
function client() {
  const stored = new Map(), history = [], alerts = [];
  const noop = () => {};
  const nodes = [];
  const element = (tag, className = "", textContent = "") => {
    const node = { tag, className, textContent, dataset: {}, attributes: {}, children: [], listeners: {},
      append(...items) { this.children.push(...items); }, setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(key, callback) { this.listeners[key] = callback; } };
    nodes.push(node);
    return node;
  };
  const context = {
    moneylineSupport, soccerSupport, isSoccer: soccerSupport.isSoccer, trackers: [], parlays: [{ id: "p1", name: "Mixed parlay" }], parlayBookState: new Map(),
    currentEvents: [event], trackerSnapshots: new Map(), trackerStats: { ML: { label: "Moneyline", short: "ML" } },
    trackerStorageKey: "test", localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) },
    saveTrackers() { stored.set("test", JSON.stringify(context.trackers)); },
    syncTrackButtons: noop, setTrackerPanelOpen: noop, renderTrackers: noop, pollTrackers: noop,
    forgetSuggestions: noop, recordHistory: (tracker, final, result) => history.push({ tracker, final, result }),
    pushNotification: (kind, text) => alerts.push({ kind, text }), firstAnnouncement: () => true, playCashSound: noop,
    element, document: { querySelectorAll: () => nodes.filter(node => node.className === "moneyline-track") },
    formatAmericanOdds: value => String(value), sportsbookTitle: value => value,
    choosePickPlacement: async () => "p1", showBanner: text => { throw new Error(text); },
    trackerClock: () => ({ tone: "live", text: "Live" })
  };
  runInNewContext([
    slice("    function trackerSide(", "    const trackerSnapshots = new Map();"),
    slice("    function readTrackers(", "    function readParlays("),
    slice("    // Over keys keep their original shape", "    function syncTrackButtons("),
    slice("    function addTracker(", "    const historyKey = "),
    slice("    function updateTracker(", "    // Packs the tracking windows"),
    slice("    function assessTracker(", "    function gameRecap("),
    slice("    function performanceVerdict(", "    function pickMessage("),
    slice("    function createMoneylineTrackControl(", "    function createTrackControls("),
    slice("    function createMoneylineTrackerCard(", "    function renderTrackers("),
    slice("    function gameRecap(", "    function underRecap("),
    slice("    function buildParlayReport(", "    const emailInFlight"),
    slice("    async function resolveParlayBook(", "    const suggestionId"),
    slice("    // A parlay wins only if every leg hits", "    // Applause:")
  ].join("\n"), context);
  return { context, history, alerts, nodes };
}

test("tracking control adds a moneyline to a parlay, persists, reloads and settles without player stats", async () => {
  const { context: c, history, alerts } = client();
  const button = c.createMoneylineTrackControl(event, event.home_team, { book: "fanduel", price: 1.9 }, "basketball_nba");
  await button.listeners.click();
  assert.equal(c.trackers.length, 1);
  const tracker = c.trackers[0];
  assert.equal(tracker.selection, "home");
  assert.equal(tracker.parlay, "p1");
  assert.equal(c.readTrackers()[0].stat, "ML");
  assert.equal(button.attributes["aria-pressed"], "true");
  c.updateTracker(tracker, game(tracker.sport, 20, 10));
  assert.equal(c.pickOutcome(tracker, c.trackerSnapshots.get(tracker.key)), "live");
  assert.equal(history.length, 0);
  const assessment = c.assessTracker(tracker, c.trackerSnapshots.get(tracker.key));
  const card = c.createMoneylineTrackerCard(tracker, c.trackerSnapshots.get(tracker.key), assessment);
  assert.ok(card.className.includes("moneyline-card"));
  assert.ok(card.children.some(node => node.textContent.includes?.("Away Team 10 - 20 Home Team")));
  c.updateTracker(tracker, game(tracker.sport, 100, 90, "post"));
  c.updateTracker(tracker, game(tracker.sport, 100, 90, "post"));
  assert.equal(history.length, 1);
  assert.equal(history[0].result, "win");
  assert.equal(alerts.filter(item => item.text.includes("moneyline: won")).length, 1);
});

test("a moneyline can be a single and a parlay leg without duplicate copies or false wins after feed failures", () => {
  const { context: c } = client();
  const single = c.addTracker(event.home_team, "soccer_epl", event.id, "ML", 1, "");
  const leg = c.addTracker(event.home_team, "soccer_epl", event.id, "ML", 1, "p1");
  assert.notEqual(single.key, leg.key);
  assert.equal(c.addTracker(event.home_team, "soccer_epl", event.id, "ML", 1, "p1"), leg);
  c.updateTracker(leg, game(leg.sport, 2, 0, "post"));
  c.updateTracker(leg, null, "Network unavailable");
  assert.equal(c.pickOutcome(leg, c.trackerSnapshots.get(leg.key)), "live");
  assert.equal(c.addTracker("Wrong Team", "soccer_epl", event.id, "ML", 1, ""), null);
});

test("moneyline phone alerts follow scores and send one final, with no player-stat alerts", async () => {
  const { trackerAlerts } = await import("./push.mjs");
  const tracker = pick("soccer_epl", "draw");
  let result = trackerAlerts(tracker, null, game(tracker.sport, 0, 0));
  assert.equal(result.messages.length, 0);
  result = trackerAlerts(tracker, result.next, game(tracker.sport, 1, 1));
  assert.equal(result.messages[0].title, "Moneyline score update");
  result = trackerAlerts(tracker, result.next, game(tracker.sport, 1, 1, "post"));
  assert.equal(result.messages[0].title, "Moneyline won");
  assert.equal(trackerAlerts(tracker, result.next, game(tracker.sport, 1, 1, "post")).messages.length, 0);
  assert.equal(trackerAlerts(tracker, null, game(tracker.sport, 2, 1, "post", { period: 4 })).messages.length, 0);
  assert.equal(trackerAlerts(tracker, null, game(tracker.sport, 1, 1, "post"), () => false).messages.length, 0);
});

test("mixed parlays stay live during a lead, count only final moneyline wins and drop tied two-way legs", () => {
  const { context: c } = client();
  const ml = c.addTracker(event.home_team, "basketball_nba", event.id, "ML", 1, "p1");
  const prop = { key: "prop", name: "Test Player", stat: "PTS", target: 10, sport: "basketball_nba" };
  c.trackerStats.PTS = { label: "Points", short: "PTS" };
  c.trackerSnapshots.set(prop.key, { current: 10, state: "post", found: true, stats: {} });
  c.updateTracker(ml, game(ml.sport, 20, 10));
  assert.equal(c.parlayStatus([ml, prop]).label, "Live");
  c.updateTracker(ml, game(ml.sport, 100, 90, "post"));
  assert.equal(c.parlayStatus([ml, prop]).hits, 2);
  assert.ok(c.buildParlayReport(c.parlays[0], [ml, prop]).sections[0].items[0].includes("WIN"));
  c.updateTracker(ml, game(ml.sport, 100, 100, "post"));
  assert.equal(c.parlayStatus([ml, prop]).total, 1);
  assert.ok(c.buildParlayReport(c.parlays[0], [ml, prop]).sections[0].items[0].includes("NO ACTION"));
});

test("parlay sportsbook resolves moneyline quotes without requesting or adjusting player-prop lines", async () => {
  const { context: c } = client();
  c.safeLink = value => value || "";
  const tracker = c.addTracker(event.home_team, "basketball_nba", event.id, "ML", 1, "p1");
  const parlay = c.parlays[0];
  parlay.sportsbook = "fanduel";
  const paths = [];
  c.getJson = async path => {
    paths.push(path);
    return [{ ...event, bookmakers: [{ key: "fanduel", title: "FanDuel", markets: [{ key: "h2h",
      outcomes: [{ name: event.home_team, price: 1.9, link: "https://example.com/bet" }] }] }] }];
  };
  await c.resolveParlayBook(parlay, [tracker], "test");
  const state = c.parlayBookState.get(parlay.id);
  assert.equal(state.status, "ready");
  assert.ok(paths.every(path => path.startsWith("/api/odds?")));
  assert.equal(state.legs.get(tracker.key).suggest, undefined);
  assert.equal(tracker.odds.price, 1.9);
  assert.equal(tracker.target, 1);
});
