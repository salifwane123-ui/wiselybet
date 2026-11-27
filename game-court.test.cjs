const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");

const html = readFileSync(join(__dirname, "game.html"), "utf8");
const start = html.indexOf("    // Live court:");
const end = html.indexOf("    // Acting plays out on the floor", start);
assert.ok(start >= 0 && end > start, "Couldn't find the live court helpers in game.html");
const court = runInNewContext(`${html.slice(start, end)}
({ isBasketballSport, courtSpot, hoopSpot, playKind, playMade, whistleLabel, attackingSide, playSpot });`);

const point = spot => ({ x: Math.round(spot.x * 10) / 10, y: Math.round(spot.y * 10) / 10 });
const fromHoop = (spot, end) => {
  const hoop = court.hoopSpot(end);
  return Math.hypot(spot.x - hoop.x, spot.y - hoop.y);
};
const play = fields => ({ id: "4019092851", text: "", x: null, y: null, ...fields });

const watchSource = html.slice(html.indexOf("    function watchSport("), html.indexOf("    async function refreshGame("));
function watchFixture(sport, entries) {
  return { sport, state: "in", period: 2, status: "In progress", updatedAt: new Date().toISOString(),
    teams: [{ name: "Fixture team", id: "team", players: entries.map(([name, stats, extra]) => ({
      name, stats: Object.entries(stats).map(([label, value]) => ({ label, value: String(value) })), ...extra
    })) }] };
}
function watchPage(sport) {
  const nodes = new Map(), timers = new Map();
  const node = () => ({ value: "", textContent: "", hidden: false, children: [],
    addEventListener() {}, append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; } });
  const get = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const context = { game: { sport }, document: { querySelector: get }, element: node, Option: class {},
    isSoccerSport: require("./soccer.js").isSoccer,
    setTimeout(fn) { timers.set(fn, true); return fn; }, clearTimeout(id) { timers.delete(id); } };
  return { ...runInNewContext(`${watchSource}\n({ watchRows, watchComparison, renderWatchlist })`, context), get, timers };
}

test("NBA watchlist requires meaningful minutes and opportunity; injuries and foul-outs take precedence", () => {
  const sport = "basketball_nba", app = watchPage(sport);
  const stats = { MIN: "08:20", PTS: 9, FG: "4-6", PF: 3 };
  const data = watchFixture(sport, [["In rotation", stats], ["Quick burst", { ...stats, MIN: "07:59" }],
    ["Missing attempts", { ...stats, FG: "—" }], ["Fouled out", { ...stats, PF: 6 }],
    ["Injured", stats], ["Playmaker", { MIN: 12, AST: 6 }]]);
  data.injuries = [{ name: "Injured", teamId: "team", status: "Out" }];
  const rows = app.watchRows(data);
  assert.deepEqual(Array.from(rows, r => [r.name, r.market]), [["Playmaker", "assists"], ["In rotation", "points"]]);
  assert.match(rows[1].evidence, /9 points on 6 field-goal attempts/);
  assert.match(rows[1].caution, /3 fouls/);
});

test("NFL compares similar workloads, selects one market per player, and caps the list at three", () => {
  const sport = "americanfootball_nfl", app = watchPage(sport);
  const rows = app.watchRows(watchFixture(sport, [
    ["Quarterback", { "passing C/ATT": "12/16", "passing YDS": 160, "rushing CAR": 5, "rushing YDS": 30 }],
    ["Runner", { "rushing CAR": 7, "rushing YDS": 45 }], ["Receiver", { "receiving REC": 4, "receiving YDS": 40 }],
    ["One long catch", { "receiving REC": 1, "receiving YDS": 85 }], ["Few yards", { "rushing CAR": 12, "rushing YDS": 26 }],
    ["Fourth eligible", { "receiving REC": 3, "receiving YDS": 31 }]
  ]));
  assert.deepEqual(Array.from(rows, r => r.market), ["passing yards", "rushing yards", "receiving yards"]);
  assert.match(rows[0].evidence, /160 passing yards on 16 pass attempts/);
});

test("NHL distinguishes skater shots and goalie saves; soccer requires on-field shots and ignores bench and season totals", () => {
  const app = watchPage("icehockey_nhl");
  const hockey = app.watchRows(watchFixture("icehockey_nhl", [["Goalie", { SA: 14, SV: 13 }],
    ["Skater", { S: 3, TOI: "05:15" }], ["No shots faced", { SV: 20 }], ["Short shift", { S: 3, TOI: "04:59" }]]));
  assert.deepEqual(Array.from(hockey, r => r.market), ["saves", "shots on goal"]);
  const soccer = app.watchRows(watchFixture("soccer_epl", [["Forward", { SH: 3, SOT: 2, YC: 1 }, { onCourt: true }],
    ["Bench", { SH: 5, SOT: 3 }], ["Off", { SH: 5, SOT: 3, SUBOUT: 1 }, { onCourt: true }],
    ["Season only", { seasonShots: 53 }, { onCourt: true }]]));
  assert.deepEqual(Array.from(soccer, r => r.name), ["Forward"]);
  assert.match(soccer[0].caution, /booked/);
});

test("watchlist handles scheduled, live, stale, failed and final updates without leaving a comparison on screen", () => {
  const sport = "basketball_nba", app = watchPage(sport);
  const data = watchFixture(sport, [["Guard", { MIN: 12, AST: 6 }]]);
  app.renderWatchlist({ ...data, state: "pre" });
  assert.match(app.get("#watch-status").textContent, /Ready for game time/);
  const fresh = () => { app.renderWatchlist(data); assert.equal(app.get("#watch-quote").hidden, false); assert.equal(app.get("#watch-cards").children.length, 1); };
  fresh();
  app.get("#watch-market").value = app.watchRows(data)[0].id;
  app.get("#watch-price").value = "-110";
  app.renderWatchlist(data);
  assert.equal(app.get("#watch-price").value, "-110");
  Array.from(app.timers.keys())[0]();
  assert.equal(app.get("#watch-price").value, "");
  for (const [snapshot, failure] of [[{ ...data, state: "post" }], [{ ...data, status: "Suspended" }],
    [{ ...data, updatedAt: new Date(Date.now() - 65000).toISOString() }], [null, "Feed unavailable"]]) {
    fresh(); app.renderWatchlist(snapshot, failure);
    assert.equal(app.get("#watch-cards").children.length, 0);
    assert.equal(app.get("#watch-quote").hidden, true);
  }
  const cl = watchPage("soccer_uefa_champs_league");
  cl.renderWatchlist(watchFixture("soccer_uefa_champs_league", [["Forward", { SH: 3, SOT: 1 }, { onCourt: true }]]));
  assert.equal(cl.get("#watch-cards").children.length, 1);
  assert.equal(cl.get("#watch-quote").hidden, true);
});

test("manual comparison uses full-game totals and the price threshold, not a win forecast", () => {
  const { watchComparison } = watchPage("basketball_nba"), player = { name: "Guard", market: "points", current: 13 };
  assert.match(watchComparison(player, "Over", "19.5", "−110"), /Needs 7 more.*52\.4%.*not a forecast/);
  assert.match(watchComparison(player, "Under", "19.5", "+125"), /at most 6.*44\.4%/);
  assert.match(watchComparison(player, "Under", "12.5", "+100"), /already above/);
  assert.match(watchComparison(player, "Over", "19", "-110"), /half-point line/);
  assert.match(watchComparison(player, "Over", "19.5", "1.91"), /American odds/);
});

test("broadcast scores precede the playing surface and sport diagrams keep their proportions", () => {
  const frame = html.slice(html.indexOf('<section class="court-card"'), html.indexOf("  </section>", html.indexOf('<section class="court-card"')));
  assert.ok(frame.indexOf('<div class="court-score">') < frame.indexOf('<div class="court">'));
  assert.ok(frame.indexOf('id="soccer-events"') > frame.indexOf('<div class="court">'));
  for (const id of ["home-score", "away-score", "home-logo", "away-logo", "clock", "period"]) {
    assert.equal((frame.match(new RegExp(`id="${id}"`, "g")) || []).length, 1);
  }
  for (const [sport, width, height] of [["football", 1200, 533], ["baseball", 900, 580], ["hockey", 1000, 425]]) {
    assert.match(frame, new RegExp(`class="${sport}-${sport === "hockey" ? "rink" : "field"}-lines" viewBox="0 0 ${width} ${height}"`));
    assert.match(html, new RegExp(`\\.${sport}-scoreboard \\.court \\{ aspect-ratio: ${width} / ${height};`));
  }
  assert.match(frame, /Playing surfaces are illustrative, not live player positions/);
});

test("only basketball games get the live court", () => {
  assert.equal(court.isBasketballSport("basketball_nba"), true);
  assert.equal(court.isBasketballSport("basketball_wnba"), true);
  assert.equal(court.isBasketballSport("icehockey_nhl"), false);
  assert.equal(court.isBasketballSport("americanfootball_nfl"), false);
});

test("ESPN spots map onto a to-scale floor, away attacking the left hoop and home the right", () => {
  assert.deepEqual(point(court.courtSpot("left", 25, 1)), { x: 52.5, y: 250 });
  assert.deepEqual(point(court.courtSpot("right", 25, 1)), { x: 887.5, y: 250 });
  // The right end is the left end turned half a turn around center court.
  const left = court.courtSpot("left", 8, 20);
  const right = court.courtSpot("right", 8, 20);
  assert.deepEqual(point(right), point({ x: 940 - left.x, y: 500 - left.y }));
  // A corner three sits beyond the 22 ft corner line; a 15-footer is inside the arc and a 26-footer beyond it.
  assert.ok(court.courtSpot("left", 48, -1).y > 470);
  assert.ok(fromHoop(court.courtSpot("left", 25, 16), "left") < 237.5);
  assert.ok(fromHoop(court.courtSpot("right", 25, 27), "right") > 237.5);
  // Spots never leave the floor.
  const wild = court.courtSpot("left", 80, 120);
  assert.ok(wild.x <= 940 && wild.y <= 500);
});

test("play types are sorted into the kinds acted out on the court", () => {
  const kinds = [
    ["Pullup Jump Shot", true, "shot"],
    ["Driving Layup Shot", true, "shot"],
    ["Running Dunk Shot", false, "shot"],
    ["Free Throw - 1 of 2", true, "freethrow"],
    ["No Shot (Default Shot)", true, "other"],
    ["Defensive Rebound", false, "rebound"],
    ["Offensive Rebound", false, "rebound"],
    ["Bad Pass\nTurnover", false, "turnover"],
    ["Shot Clock Turnover", false, "turnover"],
    ["Traveling", false, "turnover"],
    ["Shooting Foul", false, "foul"],
    ["Offensive Charge", false, "foul"],
    ["Defensive Goaltending", false, "foul"],
    ["Substitution", false, "sub"],
    ["Full Timeout", false, "timeout"],
    ["End Period", false, "period"],
    ["End Game", false, "period"],
    ["Jumpball", false, "jumpball"],
    ["Coach's Challenge (Stands)", false, "other"]
  ];
  for (const [type, shot, kind] of kinds) {
    assert.equal(court.playKind({ type, shot }), kind, type);
  }
  assert.equal(court.whistleLabel({ type: "Offensive Charge" }), "CHARGE");
  assert.equal(court.whistleLabel({ type: "Personal Foul" }), "FOUL");
  assert.equal(court.playMade({ text: "Stephen Curry makes 26-foot three point jumper", scoring: true }), true);
  assert.equal(court.playMade({ text: "Draymond Green blocks LeBron James's 3-foot layup" }), false);
});

test("defensive rebounds and defensive fouls happen at the opponent's hoop", () => {
  assert.equal(court.attackingSide({ type: "Pullup Jump Shot", shot: true, teamSide: "home" }), "home");
  assert.equal(court.attackingSide({ type: "Defensive Rebound", teamSide: "home" }), "away");
  assert.equal(court.attackingSide({ type: "Offensive Rebound", teamSide: "home" }), "home");
  assert.equal(court.attackingSide({ type: "Shooting Foul", teamSide: "away" }), "home");
  assert.equal(court.attackingSide({ type: "Offensive Foul", teamSide: "away" }), "away");
  assert.equal(court.attackingSide({ type: "Lost Ball Turnover", teamSide: "away" }), "away");
  assert.equal(court.attackingSide({ type: "Pullup Jump Shot", shot: true, teamSide: "" }), "");

  // The home team's defensive board comes off the left hoop, where the away team shoots.
  const board = court.playSpot(play({ type: "Defensive Rebound", teamSide: "home", x: 25, y: 27 }));
  assert.ok(fromHoop(board, "left") <= 90.5);
  assert.ok(board.x < 470);
});

test("free throws, and shots ESPN didn't place, still land in sensible spots", () => {
  assert.deepEqual(point(court.playSpot(play({ type: "Free Throw - 1 of 2", shot: true, teamSide: "home" }))), { x: 750, y: 250 });
  assert.deepEqual(point(court.playSpot(play({ type: "Free Throw - 2 of 2", shot: true, teamSide: "away" }))), { x: 190, y: 250 });

  const layup = court.playSpot(play({ type: "Driving Layup Shot", shot: true, teamSide: "away", text: "Jalen Brunson makes driving layup" }));
  assert.ok(fromHoop(layup, "left") <= 15);
  const three = court.playSpot(play({ type: "Jump Shot", shot: true, teamSide: "home", text: "Devin Booker misses 25-foot three point jumper" }));
  assert.ok(Math.abs(fromHoop(three, "right") - 250) < 1);

  // ESPN's own spot wins when there is one.
  assert.deepEqual(
    point(court.playSpot(play({ type: "Jump Shot", shot: true, teamSide: "away", x: 10, y: 12 }))),
    point(court.courtSpot("left", 10, 12))
  );
  assert.equal(court.playSpot(play({ type: "Personal Foul", teamSide: "home" })), null);
});
