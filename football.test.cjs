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
  assert.ok(server.includes('new Set([...playerPropMarkets.americanfootball_nfl, "player_anytime_td"])'));
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
