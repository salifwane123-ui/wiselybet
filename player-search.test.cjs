const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");
const playerSearch = require("./player-search.js");
const soccerSupport = require("./soccer.js");
const html = readFileSync("index.html", "utf8");
const server = readFileSync("server.mjs", "utf8");
const between = (source, start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `${start} … ${end}`);
  return source.slice(from, to);
};
// Objects built inside a vm context have that context's prototypes; compare plain copies.
const plain = value => JSON.parse(JSON.stringify(value));

const roster = [
  "Shai Gilgeous-Alexander", "Darius Garland", "Jalen Brunson", "Jalen Green", "Jay Huff", "LeBron James",
  "Giannis Antetokounmpo", "Karl-Anthony Towns", "Luka Dončić", "Josh Allen", "Josh Hines-Allen", "Travis Kelce",
  "Ja'Marr Chase", "Amon-Ra St. Brown", "Patrick Mahomes", "Michael Porter Jr.", "Martin Ødegaard"
].map(name => ({ name, search: playerSearch.prepare(name) }));
const names = (query, limit) => playerSearch.rank(roster, query, limit).results.map(entry => entry.name);

test("names are compared without accents, punctuation, case or generational suffixes", () => {
  assert.equal(playerSearch.normalize("Luka Dončić"), "luka doncic");
  assert.equal(playerSearch.normalize("Martin Ødegaard"), "martin odegaard");
  assert.equal(playerSearch.normalize("P.J. Washington"), "pj washington");
  assert.equal(playerSearch.normalize("Ja'Marr Chase"), "jamarr chase");
  assert.equal(playerSearch.normalize("Amon-Ra St. Brown"), "amon ra st brown");
  assert.deepEqual(playerSearch.prepare("Michael Porter Jr.").tokens, ["michael", "porter"]);
  assert.deepEqual(playerSearch.prepare("Jr").tokens, ["jr"]);
  assert.equal(playerSearch.score("luka doncic", "Luka Dončić"), 100);
  assert.equal(playerSearch.score("michael porter", "Michael Porter Jr."), 100);
});

test("similar names are found by first name, typo, initials, run-together or partial spelling", () => {
  assert.deepEqual(names("jalen"), ["Jalen Brunson", "Jalen Green"]);
  assert.equal(names("lebrn")[0], "LeBron James");
  assert.equal(names("antetokoum")[0], "Giannis Antetokounmpo");
  assert.equal(names("travis kelsey")[0], "Travis Kelce");
  assert.equal(names("pat mahomes")[0], "Patrick Mahomes");
  assert.equal(names("sga")[0], "Shai Gilgeous-Alexander");
  assert.equal(names("kat")[0], "Karl-Anthony Towns");
  assert.equal(names("jalenbrun")[0], "Jalen Brunson");
  assert.equal(names("gilgeousalexander")[0], "Shai Gilgeous-Alexander");
  assert.equal(names("jamarr")[0], "Ja'Marr Chase");
  assert.equal(names("st. brown")[0], "Amon-Ra St. Brown");
  assert.equal(names("odegaard")[0], "Martin Ødegaard");
  assert.deepEqual(names("josh allen").slice(0, 2), ["Josh Allen", "Josh Hines-Allen"]);
});

test("a run-together query must start at a word, and short words don't match inside longer ones", () => {
  assert.ok(!names("sga").includes("Darius Garland"));
  assert.deepEqual(names("son"), []);
  assert.deepEqual(playerSearch.rank(roster, "zzzz"), { results: [], approximate: false, total: 0 });
  assert.deepEqual(playerSearch.rank(roster, "   "), { results: [], approximate: false, total: 0 });
});

test("partial matches are only offered, marked approximate, when nothing matches the whole name", () => {
  const reply = playerSearch.rank(roster, "jay brunson");
  assert.equal(reply.approximate, true);
  assert.equal(reply.results[0].name, "Jalen Brunson");
  assert.ok(reply.results.some(entry => entry.name === "Jay Huff"));
  assert.equal(playerSearch.rank(roster, "jalen").approximate, false);
  const limited = playerSearch.rank(roster, "jalen", 1);
  assert.equal(limited.results.length, 1);
  assert.equal(limited.total, 2);
});

const directory = {};
runInNewContext([
  between(server, "const rosterGroupNotes =", "function espnTeamList("),
  between(server, "function playerDirectoryEntries(", "async function playerDirectoryTeams("),
  between(server, "function normalizeTeamName(", "function teamsMatch("),
  "result.playerDirectoryEntries = playerDirectoryEntries;"
].join("\n"), { soccerSupport, playerSearch, result: directory });

test("the server's player directory lists every rostered player with team names for matching games", () => {
  const teams = [
    { id: "12", displayName: "LA Clippers", shortDisplayName: "Clippers", location: "LA", name: "Clippers" },
    { id: "1", displayName: "LSU Tigers", shortDisplayName: "LSU", location: "LSU", name: "Tigers" },
    { id: "2", displayName: "Auburn Tigers", shortDisplayName: "Auburn", location: "Auburn", name: "Tigers" },
    { id: "3", displayName: "Missing Roster", location: "Missing", name: "Roster" }
  ];
  const rosters = [
    { athletes: [
      { id: "7", displayName: "Kawhi Leonard", position: { abbreviation: "F" }, jersey: "2" },
      { id: "7", displayName: "Kawhi Leonard" },
      { id: "8", fullName: "James Harden" },
      { id: "9" }
    ] },
    { athletes: [
      { position: "offense", items: [{ id: "20", displayName: "Garrett Nussmeier", position: { abbreviation: "QB" }, jersey: "13" }] },
      { position: "practiceSquad", items: [{ id: "21", displayName: "Practice Player", position: { abbreviation: "WR" } }] }
    ] },
    { athletes: [{ position: "injuredReserveOrOut", items: [{ id: "30", displayName: "Hurt Player" }] }] },
    null
  ];
  const players = plain(directory.playerDirectoryEntries("americanfootball_ncaaf", teams, rosters));
  assert.deepEqual(players.map(player => player.name), ["Kawhi Leonard", "James Harden", "Garrett Nussmeier", "Practice Player", "Hurt Player"]);
  const { search, ...kawhi } = players[0];
  assert.deepEqual(search.tokens, ["kawhi", "leonard"]);
  assert.deepEqual(kawhi, { name: "Kawhi Leonard", team: "LA Clippers", teamNames: ["LA Clippers", "Clippers"], nickname: "Clippers",
    position: "F", jersey: "2", note: "" });
  // Two teams are the Tigers, so neither nickname is enough to find a game.
  assert.equal(players[2].nickname, "");
  assert.deepEqual(players[2].teamNames, ["LSU Tigers", "LSU"]);
  assert.equal(players[3].note, "Practice squad");
  assert.equal(players[4].note, "Injured reserve/out");

  const soccer = plain(directory.playerDirectoryEntries("soccer_epl", [
    { id: "349", displayName: "AFC Bournemouth", shortDisplayName: "Bournemouth", location: "Bournemouth", name: "AFC Bournemouth" }
  ], [{ athletes: [{ id: "1", displayName: "Antoine Semenyo", position: { abbreviation: "F" } }] }]));
  assert.equal(soccer[0].nickname, "");
  assert.deepEqual(soccer[0].teamNames, ["AFC Bournemouth", "Bournemouth"]);
});

function pageGames({ sport = "basketball_nba", events = [], eventId = "", date = "all" } = {}) {
  const context = {
    soccerSupport,
    isSoccer: soccerSupport.isSoccer,
    sportSelect: { value: sport },
    dateSelect: { value: date },
    propEventSelect: { value: eventId },
    currentEvents: events,
    result: {}
  };
  runInNewContext([
    between(html, "    function localDateKey(", "    function formatDateKey("),
    between(html, "    function normalizeTeamName(", "    function teamNamesMatch("),
    between(html, "    function playerTeamIs(", "    function setPlayerDirectoryActive("),
    "Object.assign(result, { playerTeamIs, playerDirectoryGame, playerDirectoryGameText });"
  ].join("\n"), context);
  return context.result;
}

test("the page finds a suggested player's game even when the odds feed names the team differently", () => {
  const { playerTeamIs } = pageGames();
  const clipper = { teamNames: ["LA Clippers", "Clippers"], nickname: "Clippers" };
  assert.equal(playerTeamIs(clipper, "Los Angeles Clippers"), true);
  assert.equal(playerTeamIs(clipper, "LA Clippers"), true);
  assert.equal(playerTeamIs(clipper, "Los Angeles Lakers"), false);
  assert.equal(playerTeamIs({ teamNames: ["Brooklyn Nets"], nickname: "Nets" }, "Charlotte Hornets"), false);
  assert.equal(playerTeamIs({ teamNames: ["Portland Trail Blazers"], nickname: "Trail Blazers" }, "Portland Trailblazers"), true);
  assert.equal(playerTeamIs({ teamNames: ["Hawai'i Rainbow Warriors"], nickname: "" }, "Hawaii Rainbow Warriors"), true);
  assert.equal(playerTeamIs({ teamNames: ["LSU Tigers", "LSU"], nickname: "" }, "Auburn Tigers"), false);
  assert.equal(playerTeamIs(clipper, ""), false);

  const { playerTeamIs: soccerTeamIs } = pageGames({ sport: "soccer_epl" });
  assert.equal(soccerTeamIs({ teamNames: ["Manchester United", "Man United"], nickname: "" }, "Manchester United"), true);
  assert.equal(soccerTeamIs({ teamNames: ["AFC Bournemouth", "Bournemouth"], nickname: "" }, "Bournemouth"), true);
  assert.equal(soccerTeamIs({ teamNames: ["Manchester City"], nickname: "" }, "Manchester United"), false);
});

test("a suggested player opens the game on screen first, then the date filter's game, then the soonest", () => {
  const later = new Date(Date.now() + 2 * 86_400_000);
  const soon = new Date(Date.now() + 3_600_000);
  const events = [
    { id: "a", home_team: "Boston Celtics", away_team: "Los Angeles Clippers", commence_time: soon.toISOString() },
    { id: "b", home_team: "Los Angeles Clippers", away_team: "Utah Jazz", commence_time: later.toISOString() },
    { id: "c", home_team: "Denver Nuggets", away_team: "Miami Heat", commence_time: soon.toISOString() }
  ];
  const clipper = { teamNames: ["LA Clippers", "Clippers"], nickname: "Clippers" };
  const pick = options => {
    const page = pageGames({ events, ...options });
    const game = page.playerDirectoryGame(clipper);
    return { id: game?.event.id, home: game?.home, text: page.playerDirectoryGameText(game) };
  };
  const first = pick({});
  assert.equal(first.id, "a");
  assert.equal(first.home, false);
  assert.match(first.text, /^@ Boston Celtics · /);
  assert.deepEqual(pick({ eventId: "b" }), { id: "b", home: true, text: "This game" });
  const laterKey = `${later.getFullYear()}-${String(later.getMonth() + 1).padStart(2, "0")}-${String(later.getDate()).padStart(2, "0")}`;
  assert.equal(pick({ date: laterKey }).id, "b");
  assert.match(pick({ date: laterKey }).text, /^vs Utah Jazz · /);
  const nobody = pageGames({ events });
  assert.equal(nobody.playerDirectoryGame({ teamNames: ["Phoenix Suns"], nickname: "Suns" }), null);
  assert.equal(nobody.playerDirectoryGameText(null), "No game listed");
  const started = pageGames({ events: [{ ...events[0], commence_time: new Date(Date.now() - 60_000).toISOString() }] });
  assert.equal(started.playerDirectoryGameText(started.playerDirectoryGame(clipper)), "@ Boston Celtics · Started");
});

test("the matcher ships to the page and the search endpoint is open to guests", () => {
  assert.ok(html.includes('<script src="/player-search.js"></script>'));
  assert.match(server, /url\.pathname === "\/player-search\.js"/);
  assert.match(between(server, "const guestAllowed =", "\n"), /"\/api\/players"/);
  assert.match(html, /id="prop-search"[^>]*role="combobox"[^>]*aria-controls="prop-search-list"/);
  assert.match(html, /id="prop-search-list" role="listbox"/);
});
