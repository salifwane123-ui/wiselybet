const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");
const football = require("./football.js");
const html = readFileSync("index.html", "utf8");
const server = readFileSync("server.mjs", "utf8");
const slice = (start, end) => {
  const from = html.indexOf(start), to = html.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return html.slice(from, to);
};

test("Anytime Touchdown normalizes Yes/No quotes to the fixed 0.5 line, retaining sportsbook prices and links", () => {
  for (const [name, side] of [["Yes", "Over"], ["No", "Under"]]) {
    const quote = football.anytimeOutcome({ name, description: "Player One", price: 2.1, link: "https://book.example/pick" });
    assert.equal(quote.name, side);
    assert.equal(quote.point, 0.5);
    assert.equal(quote.price, 2.1);
    assert.equal(quote.link, "https://book.example/pick");
  }
  assert.equal(football.anytimeOutcome({ name: "Yes", price: 2 }), null);
  assert.equal(football.anytimeOutcome({ name: "Yes", description: "Player", price: Infinity }), null);
  assert.equal(football.anytimeOutcome({ name: "Maybe", description: "Player", price: 2 }), null);
});

test("touchdowns count rushing, receiving and return scores without passing TDs, conversions or duplicate defensive TDs", () => {
  assert.equal(football.touchdowns({ "passing TD": "4", "receiving 2PT": "1", "kicking XP": "3" }), 0);
  assert.equal(football.touchdowns({ "rushing TD": "1", "receiving TD": "2", "kickReturns TD": "1", "puntReturns TD": "1",
    "defensive TD": "1", "interceptions TD": "1" }), 6);
  assert.equal(football.touchdowns({ "interceptions TD": "1" }), 1);
  assert.equal(football.touchdowns({ "rushing TD": "--" }), 0);
});

test("NFL Anytime Touchdown connects market, tracker stat and no-alternate sportsbook request", () => {
  assert.ok(html.includes('["player_anytime_td", "Anytime Touchdown"]'));
  assert.ok(html.includes('player_anytime_td: "TD"'));
  assert.ok(html.includes('stats.TD = String(footballSupport.touchdowns(stats))'));
  assert.ok(html.includes('script src="/football.js"'));
  assert.ok(server.includes('"/football.js"'));
  assert.ok(server.includes('"player_pass_rush_yds", "player_rush_reception_yds", "player_anytime_td"]);'));
  assert.ok(server.includes('new Set(["batter_stolen_bases", "player_anytime_td"])'));
});

test("Anytime Touchdown tracking fixes Yes and one touchdown, then allows regular stats again", () => {
  function node(tag) {
    return { tag, value: "", children: [], listeners: {}, hidden: false, disabled: false, dataset: {},
      classList: { toggle() {}, remove() {} }, setAttribute() {},
      append(...nodes) { this.children.push(...nodes); },
      addEventListener(name, fn) { this.listeners[name] = fn; } };
  }
  const c = {
    footballSupport: football, element: node, document: { createElement: node },
    syncTrackButtons() {},
    trackerStats: { TD: { label: "Anytime Touchdown" }, RYD: { label: "Rushing yards" } },
    trackerStatsBySport: { americanfootball_nfl: ["TD", "RYD"] },
    marketToTrackerStatBySport: { americanfootball_nfl: { player_anytime_td: "TD" } }
  };
  runInNewContext(slice("    function createTrackControls(", "    // Adds a pick to a parlay"), c);
  const controls = c.createTrackControls({ player: "Player One", lines: [{ point: 0.5 }] }, "americanfootball_nfl", "e1", "player_anytime_td");
  const selects = controls.form.children.filter(item => item.tag === "select");
  const input = controls.form.children.find(item => item.tag === "input");
  assert.equal(selects[0].value, "TD");
  assert.equal(selects[1].value, "over");
  assert.equal(selects[1].disabled, true);
  assert.equal(input.value, "1");
  assert.equal(input.disabled, true);
  selects[0].value = "RYD";
  selects[0].listeners.change();
  assert.equal(selects[1].disabled, false);
  assert.equal(input.disabled, false);
});

test("phone tracking excludes passing TDs and settles scored, missed and no-participation Anytime Touchdown picks", async () => {
  const { trackerAlerts } = await import("./push.mjs");
  const tracker = { key: "td", sport: "americanfootball_nfl", name: "Player One", stat: "TD", target: 1 };
  const game = (rush, receive, state = "in", appeared = true) => ({
    state, teams: [{ players: appeared ? [{ name: tracker.name, stats: [
      { label: "passing TD", value: "3" }, { label: "rushing TD", value: String(rush) },
      { label: "receiving TD", value: String(receive) }
    ] }] : [] }]
  });

  const baseline = trackerAlerts(tracker, null, game(0, 0));
  assert.equal(baseline.next.current, 0);
  const hit = trackerAlerts(tracker, baseline.next, game(0, 1));
  assert.equal(hit.next.outcome, "won");
  assert.ok(hit.messages.some(message => message.title.includes("Target hit")));
  assert.equal(trackerAlerts(tracker, baseline.next, game(0, 0, "post")).next.outcome, "lost");
  const missing = trackerAlerts(tracker, baseline.next, game(0, 0, "post", false));
  assert.equal(missing.next.outcome, "void");
  assert.ok(missing.messages.some(message => message.title.includes("no action")));
});

test("browser tracker derives scored touchdowns, animates once on score and marks no-score final lost", () => {
    const tracker = { key: "td", name: "Player One", stat: "TD", sport: "americanfootball_nfl", target: 1, eventId: "e1" };
    const snapshots = new Map();
    const animations = [], notifications = [];
    const c = {
      footballSupport: football, trackerSnapshots: snapshots, trackers: [tracker], parlays: [],
      isSoccer: () => false, isFootballSport: () => true, isUnderPick: () => false, followedPlayers: [],
      normalizeTeamName: value => value, gameMinutesRemaining: () => 30,
      trackerStats: { TD: { label: "Anytime Touchdown" } }, pickReached: () => false, recordHistory() {},
      firstAnnouncement: () => true, playCashSound() {}, pickIdentity: tracker => tracker.key, pickLine: target => target - 0.5,
      pushNotification: (...args) => notifications.push(args), showScorePop: (...args) => animations.push(args)
    };
    runInNewContext(slice("    function pickOutcome(", "    const trackerSnapshots ="), c);
    const start = html.indexOf("    function pickMessage(");
    const stop = html.indexOf("      const need = tracker.target - snapshot.current;", start);
    runInNewContext(html.slice(start, stop) + "\n    }\n" +
      slice("    function trackerUpdatesEnabled(", "    // Packs the tracking windows"), c);
    const game = (rush, receiving, state = "in") => ({ state, teams: [{ players: [{ name: tracker.name, stats: [
      { label: "passing TD", value: "4" }, { label: "rushing TD", value: String(rush) },
      { label: "receiving TD", value: String(receiving) }
    ] }] }] });
    c.updateTracker(tracker, game(0, 0), "");
    assert.equal(snapshots.get("td").current, 0);
    assert.equal(animations.length, 0);
    c.updateTracker(tracker, game(1, 0), "");
    assert.equal(snapshots.get("td").current, 1);
    assert.equal(c.pickOutcome(tracker, snapshots.get("td")), "won");
    assert.equal(animations.length, 1);
    assert.ok(notifications.length > 0);
    c.updateTracker(tracker, game(1, 0), "");
    assert.equal(animations.length, 1);
    snapshots.clear();
    c.updateTracker(tracker, game(0, 0, "post"), "");
    assert.equal(c.pickOutcome(tracker, snapshots.get("td")), "lost");
});

test("NFL Passing + rushing and Rushing + receiving yards are prop markets with tracker stats and alternate lines", () => {
  assert.ok(html.includes('["player_pass_rush_yds", "Passing + rushing yards"], ["player_rush_reception_yds", "Rushing + receiving yards"]'));
  assert.ok(html.includes('player_pass_rush_yds: "PRYD",'));
  assert.ok(html.includes('player_rush_reception_yds: "RRYD", player_anytime_td: "TD"'));
  assert.ok(html.includes('"RECYD", "RECTD", "PRYD", "RRYD", "TD"]'));
  assert.ok(html.includes('PRYD: { label: "Passing + rushing yards"'));
  assert.ok(html.includes('RRYD: { label: "Rushing + receiving yards"'));
  assert.ok(!/marketsWithoutAlternates = new Set\([^)]*(pass_rush|rush_reception)/.test(server));
});

const comboGame = (state = "in") => ({ state, teams: [{ players: [{ name: "Player One", stats: [
  { label: "passing C/ATT", value: "18/27" }, { label: "passing YDS", value: "251" },
  { label: "rushing CAR", value: "6" }, { label: "rushing YDS", value: "-4" },
  { label: "receiving REC", value: "9" }, { label: "receiving YDS", value: "120" }
] }] }] });

test("phone tracking sums combined NFL yards, including negative rushing, and settles them", async () => {
  const { trackerAlerts } = await import("./push.mjs");
  for (const [stat, total] of [["PRYD", 247], ["RRYD", 116]]) {
    const tracker = { key: stat, sport: "americanfootball_nfl", name: "Player One", stat, target: 200 };
    const live = trackerAlerts(tracker, null, comboGame());
    assert.equal(live.next.current, total);
    assert.equal(trackerAlerts({ ...tracker, target: total + 1 }, live.next, comboGame("post")).next.outcome, "lost");
  }
  const hit = trackerAlerts({ key: "h", sport: "americanfootball_nfl", name: "Player One", stat: "PRYD", target: 247 },
    { current: 240, outcome: "" }, comboGame());
  assert.equal(hit.next.outcome, "won");
  assert.ok(hit.messages.some(message => message.body.includes("reached 247 passing + rushing yards")));
});

test("browser tracker sums combined NFL yards from the live box score", () => {
  const snapshots = new Map();
  const c = {
    footballSupport: football, trackerSnapshots: snapshots, trackers: [], parlays: [],
    isSoccer: () => false, isFootballSport: () => true, isUnderPick: () => false, followedPlayers: [],
    normalizeTeamName: value => value, gameMinutesRemaining: () => 30,
    trackerStats: { PRYD: { label: "Passing + rushing yards", short: "PASS+RUSH YDS" }, RRYD: { label: "Rushing + receiving yards", short: "RUSH+REC YDS" } },
    pickReached: () => false, recordHistory() {}, firstAnnouncement: () => true, playCashSound() {},
    pickIdentity: tracker => tracker.key, pickLine: target => target - 0.5, pushNotification() {}, showScorePop() {}
  };
  runInNewContext(slice("    function pickOutcome(", "    const trackerSnapshots ="), c);
  runInNewContext(slice("    function trackerUpdatesEnabled(", "    // Packs the tracking windows"), c);
  for (const [stat, total] of [["PRYD", 247], ["RRYD", 116]]) {
    const tracker = { key: stat, name: "Player One", stat, sport: "americanfootball_nfl", target: 100, eventId: "e1" };
    c.trackers = [tracker];
    c.updateTracker(tracker, comboGame(), "");
    assert.equal(snapshots.get(stat).current, total);
    assert.equal(c.pickOutcome(tracker, snapshots.get(stat)), "won");
  }
});
