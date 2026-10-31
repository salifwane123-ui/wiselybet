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
