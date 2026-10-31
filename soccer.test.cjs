const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");
const soccer = require("./soccer.js");

test("all seven requested leagues have ESPN routes, with explicit Champions League prop limits", () => {
  assert.equal(Object.keys(soccer.leagues).length, 7);
  assert.equal(soccer.leagues.soccer_epl.espn, "soccer/eng.1");
  assert.equal(soccer.leagues.soccer_uefa_champs_league.props, false);
  assert.equal(Object.values(soccer.leagues).filter(league => league.props).length, 6);
  assert.deepEqual(soccer.markets.map(([key]) => key), ["player_shots", "player_shots_on_target", "player_assists"]);
});

test("soccer clock counts up through halves and stoppage, never using NBA countdown rules", () => {
  const clock = (value, period = 1, detail = "") => soccer.clock({ state: "in", period, clock: value, periodLabel: detail });
  assert.equal(clock("10:30").remaining, 79.5);
  assert.equal(clock("67'", 2).remaining, 23);
  assert.equal(clock("45+3'", 1).elapsed, 48);
  assert.equal(clock("90+5'", 2).remaining, 0);
  assert.equal(clock("", 1, "Halftime").remaining, 45);
  assert.equal(clock("", 2, "67'").elapsed, 67);
  assert.equal(clock("", 1).remaining, null);
  assert.equal(soccer.clock({ state: "pre" }).remaining, 90);
  assert.equal(soccer.clock({ state: "post" }).remaining, 0);
});

test("soccer names match aliases without merging unrelated United clubs", () => {
  assert.equal(soccer.teamName("Man Utd"), soccer.teamName("Manchester United"));
  assert.equal(soccer.teamName("Bayern Munich"), soccer.teamName("Bayern München"));
  assert.equal(soccer.teamName("AFC Bournemouth"), soccer.teamName("Bournemouth"));
  assert.notEqual(soccer.teamName("Manchester United"), soccer.teamName("Newcastle United"));
});
test("soccer goals, cards and substitutions become alerts, but overturned goals do not", () => {
  assert.equal(soccer.alertKind({ scoring: true, type: "Goal", text: "Goal! Palmer scores." }), "score");
  assert.equal(soccer.alertKind({ type: "Yellow Card", text: "Palmer booked." }), "foul");
  assert.equal(soccer.alertKind({ type: "Substitution", text: "Palmer replaces Smith." }), "court");
  assert.equal(soccer.alertKind({ scoring: true, type: "Goal", text: "Goal disallowed by VAR." }), "");
});

test("ESPN soccer rosters map stats and preserve non-playing substitutes without inventing zero stats", () => {
  const roster = { roster: [
    { athlete: { id: 1, displayName: "Starter" }, starter: true, stats: [
      { name: "appearances", value: 1 }, { name: "totalGoals", value: 0 }, { name: "totalShots", value: 3 },
      { name: "shotsOnTarget", value: 2 }, { name: "goalAssists", value: 1 }, { name: "yellowCards", value: 1 }
    ] },
    { athlete: { id: 2, displayName: "Bench" }, stats: [{ name: "appearances", value: 0 }] },
    { athlete: { id: 3, displayName: "Unverified starter" }, starter: true, stats: [] }
  ] };
  const players = soccer.players(roster, "in");
  assert.equal(players.length, 3);
  assert.equal(players[0].appeared, true);
  assert.deepEqual(players[0].stats.find(stat => stat.label === "SH"), { label: "SH", value: "3" });
  assert.equal(players[1].appeared, false);
  assert.equal(players[2].appeared, false);
  assert.equal(players[2].stats.length, 0);
});

test("soccer live parlay reads use verified shots and no NBA pace bonus", async () => {
  const { bestParlayMarkets, liveRead } = await import("./best-parlay.mjs");
  assert.equal(bestParlayMarkets.soccer_uefa_champs_league, undefined);
  const game = { state: "in", period: 2, clock: "65'", teams: [
    { abbreviation: "CHE", score: "1", players: [{ name: "Cole Palmer", appeared: true, stats: [{ label: "SH", value: "1" }] }] },
    { abbreviation: "ARS", score: "1", players: [] }
  ] };
  const read = liveRead({ sport: "soccer_epl", market: "player_shots", player: "Cole Palmer", line: 2.5, game });
  assert.equal(read.read.current, 1);
  assert.equal(read.read.left, 25);
  assert.equal(read.bonus, 0);
  assert.equal(read.read.projected, undefined);
  assert.equal(liveRead({ sport: "soccer_epl", market: "player_assists", player: "Cole Palmer", line: .5, game }).skip, "unverified");
});

test("soccer push alerts track goals, cards, finals and reject extra-time settlement", async () => {
  const { trackerAlerts } = await import("./push.mjs");
  const tracker = { key: "s1", sport: "soccer_epl", name: "Cole Palmer", stat: "SH", target: 3 };
  const game = (shots, yellow = 0, period = 2, state = "in") => ({ sport: tracker.sport, state, period, teams: [
    { players: [{ name: tracker.name, appeared: true, stats: [
      { label: "SH", value: String(shots) }, { label: "YC", value: String(yellow) }, { label: "RC", value: "0" }
    ] }] }
  ] });
  const first = trackerAlerts(tracker, null, game(1));
  const changed = trackerAlerts(tracker, first.next, game(3, 1));
  assert.ok(changed.messages.some(message => message.title.includes("Target hit")));
  assert.ok(changed.messages.some(message => message.title === "Card update"));
  assert.ok(!changed.messages.some(message => message.title.includes("Court")));
  assert.equal(trackerAlerts(tracker, changed.next, game(4, 1, 3)).messages.length, 0);
  assert.ok(trackerAlerts(tracker, changed.next, game(3, 1, 2, "post")).messages.some(message => message.title.includes("Final")));
  assert.equal(trackerAlerts(tracker, null, { ...game(1), teams: [] }).messages.length, 0);
});

test("browser soccer configuration connects league navigation, props and trackers", () => {
  const html = readFileSync("index.html", "utf8");
  const context = { soccerSupport: soccer };
  const start = html.indexOf("const supportedSports =");
  const end = html.indexOf("function element(", start);
  runInNewContext(html.slice(start, end) + ";globalThis.sports = supportedSports; globalThis.props = playerPropSports;", context);
  for (const key of Object.keys(soccer.leagues)) assert.ok(context.sports.includes(key));
  assert.match(context.props.soccer_uefa_champs_league.unavailable, /not currently covered/);
  assert.equal(context.props.soccer_epl.markets.length, 3);
  assert.match(html, /script src="\/soccer\.js"/);
});
test("server soccer routes connect all leagues while rejecting unsupported Champions League props", () => {
  const source = readFileSync("server.mjs", "utf8");
  const context = { soccerSupport: soccer };
  const start = source.indexOf("const espnScoreboardSports =");
  const end = source.indexOf("// Every supported prop market", start);
  runInNewContext(source.slice(start, end) +
    ";globalThis.espn = espnScoreboardSports; globalThis.live = liveGameSports; globalThis.props = playerPropMarkets;", context);
  for (const [key, league] of Object.entries(soccer.leagues)) {
    assert.equal(context.espn[key], league.espn);
    assert.equal(context.live.has(key), true);
    if (league.props) assert.equal(context.props[key].has("player_shots"), true);
  }
  assert.equal(context.props.soccer_uefa_champs_league, undefined);
});
