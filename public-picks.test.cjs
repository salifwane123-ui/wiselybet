const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");

const html = readFileSync(join(__dirname, "index.html"), "utf8");
const start = html.indexOf("    const publicPickResearch =");
const end = html.indexOf("    function signalDataFresh(", start);
assert.ok(start >= 0 && end > start);
const helpers = runInNewContext(`${html.slice(start, end)}\n({ matchingPublicPickResearch, countPublicPickAuthors });`, {
  normalizeSignalName: value => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, ""),
  localDateKey: value => String(value).slice(0, 10)
});
const event = {
  home_team: "Toronto Raptors", away_team: "Orlando Magic",
  commence_time: "2026-10-30T23:00:00Z"
};
const match = (overrides = {}) => helpers.matchingPublicPickResearch(
  overrides.player || "Franz Wagner", overrides.sport || "basketball_nba",
  overrides.market || "player_points", overrides.point ?? 22.5,
  { ...event, ...overrides.event }
);

test("public research matches only the exact player, sport, market, line, date and matchup", () => {
  const sample = match();
  assert.equal(sample.sources[0].author, "Nick Galaida");
  assert.equal(sample.sources[0].side, "under");
  for (const overrides of [
    { player: "Moritz Wagner" }, { sport: "basketball_wnba" },
    { market: "player_rebounds" }, { point: 23.5 }, { point: "22.5" },
    { event: { commence_time: "2026-10-31T23:00:00Z" } },
    { event: { away_team: "Boston Celtics" } }
  ]) assert.equal(match(overrides), null);
  assert.ok(match({ event: { home_team: event.away_team, away_team: event.home_team } }));
});

test("count unique authors, not duplicated posts; conflicting authors support neither side", () => {
  const counts = helpers.countPublicPickAuthors([
    { author: "Author One", side: "under" },
    { author: "Author One", side: "under" },
    { author: "Author Two", side: "over" },
    { author: "Author Two", side: "under" },
    { author: "", side: "over" },
    { author: "Author Three", side: "unknown" }
  ]);
  assert.equal(counts.over, 0);
  assert.equal(counts.under, 1);
  assert.equal(counts.conflicting, 1);
});

test("unresearched picks remain unknown, and the dated example is not described as live consensus", () => {
  assert.match(html, /Not researched for this exact game and line/);
  assert.match(html, /not a current pick or a count of all bettors/);
  assert.match(html, /not a consensus, win probability, or live social feed/);
  assert.match(html, /row\.append\(createPublicPickReview/);
});
