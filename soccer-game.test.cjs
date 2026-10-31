const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");

const html = readFileSync(join(__dirname, "game.html"), "utf8");
const helperStart = html.indexOf("    function soccerStatEntries");
const helperEnd = html.indexOf("    function renderSoccerTeamStats", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "Couldn't find the soccer helpers in game.html");
const soccer = runInNewContext(`${html.slice(helperStart, helperEnd)}
({ soccerStatEntries, soccerStatLabel, soccerPlaysNewestFirst, soccerPeriodName, soccerEventKind, isSoccerSport });`);

test("soccer support recognizes exactly the requested soccer league IDs", () => {
  for (const sport of [
    "soccer_epl",
    "soccer_spain_la_liga",
    "soccer_uefa_champs_league",
    "soccer_usa_mls",
    "soccer_italy_serie_a",
    "soccer_germany_bundesliga",
    "soccer_france_ligue_one"
  ]) {
    assert.equal(soccer.isSoccerSport(sport), true, sport);
  }
  assert.equal(soccer.isSoccerSport("basketball_nba"), false);
  assert.equal(soccer.isSoccerSport("icehockey_nhl"), false);
  assert.equal(soccer.isSoccerSport("soccer"), false);
  assert.equal(soccer.isSoccerSport("soccer_other"), false);
});

test("soccer period labels prefer ESPN's label and provide safe half fallbacks", () => {
  assert.equal(soccer.soccerPeriodName({ state: "in", periodLabel: "2nd Half", period: 2 }), "2nd Half");
  assert.equal(soccer.soccerPeriodName({ state: "in", period: 1 }), "First Half");
  assert.equal(soccer.soccerPeriodName({ state: "in", period: 2 }), "Second Half");
  assert.equal(soccer.soccerPeriodName({ state: "in", period: 3 }), "Extra Time · First Half");
  assert.equal(soccer.soccerPeriodName({ state: "post", period: 2 }), "Final");
  assert.equal(soccer.soccerPeriodName({ state: "pre" }), "Kickoff pending");
});

test("soccer event markers cover goals, cards, and substitutions without invented locations", () => {
  assert.equal(soccer.soccerEventKind({ text: "Goal! Alex scores" }).kind, "goal");
  assert.equal(soccer.soccerEventKind({ scoring: true, text: "Penalty" }).kind, "goal");
  assert.equal(soccer.soccerEventKind({ type: "Yellow Card", text: "Caution" }).kind, "yellow-card");
  assert.equal(soccer.soccerEventKind({ text: "Red card shown" }).kind, "red-card");
  assert.equal(soccer.soccerEventKind({ type: "Substitution", text: "Player on" }).kind, "substitution");
  assert.equal(soccer.soccerEventKind({ type: "Corner Kick", text: "Corner kick" }), null);
  assert.deepEqual(
    JSON.parse(JSON.stringify(soccer.soccerPlaysNewestFirst([
      { sequenceNumber: 2, text: "Later" },
      { sequenceNumber: 5, text: "Latest" },
      { sequenceNumber: 1, text: "Earlier" }
    ]).map(play => play.text))),
    ["Latest", "Later", "Earlier"]
  );
  assert.doesNotMatch(html.slice(html.indexOf("    function renderSoccerEvents"), html.indexOf("    function renderPlayByPlay")),
    /play\.(?:x|y)|coordinates|position/);
});

test("soccer stats retain ESPN labels and displayed values", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(soccer.soccerStatEntries([
      { label: "Shots on Target", value: "4" },
      { name: "Possession", displayValue: "61%" }
    ]))),
    [
      { label: "Shots on Target", value: "4" },
      { label: "Possession", value: "61%" }
    ]
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(soccer.soccerStatEntries({ "Yellow Cards": 2, Shots: { value: "8" } }))),
    [{ label: "Yellow Cards", value: "2" }, { label: "Shots", value: "8" }]
  );
  assert.equal(soccer.soccerStatLabel("SOT"), "Shots on target");
  assert.equal(soccer.soccerStatLabel("SUBOUT"), "Substitutions out");
  assert.equal(soccer.soccerStatLabel("Total Shots"), "Total Shots");
});

test("soccer pitch and score clock use a field illustration and ESPN's unchanged clock", () => {
  assert.match(html, /class="soccer-field-lines" viewBox="0 0 1000 640"/);
  assert.match(html, /id="soccer-events" class="soccer-events"/);
  assert.match(html, /data\.state === "in" && data\.clock \? data\.clock : data\.status/);
  assert.match(html, /player positions on the pitch are not shown/);
  assert.match(html, /Player props are unavailable for UEFA Champions League matches\./);
  const script = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));
  assert.doesNotThrow(() => new Function(script), "game page script should parse");
});
