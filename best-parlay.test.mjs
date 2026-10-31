import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bestParlayMarkets, buildBestParlay, injuredPlayers, liveClock, liveRead, normalizePlayerName, parlayBooks, propsTtlMs,
  selectSlate
} from "./best-parlay.mjs";

const now = Date.parse("2025-01-15T20:00:00Z");
const minute = 60_000;
const hour = 60 * minute;
const iso = time => new Date(time).toISOString();

// Over/Under prices with a 4.5% margin whose no-vig Over chance is exactly `chance`.
function prices(chance, margin = 0.045) {
  return [1 / (chance * (1 + margin)), 1 / ((1 - chance) * (1 + margin))];
}
function pair(player, point, over, under, link = `https://book.example/slip/${encodeURIComponent(player)}/${point}`) {
  return [
    { name: "Over", description: player, point, price: over, link },
    { name: "Under", description: player, point, price: under }
  ];
}
// books: { bookKey: { market: [[player, point, over, under, link?], ...] } }
function eventOdds(books, updated = now) {
  return {
    bookmakers: Object.entries(books).map(([key, markets]) => ({
      key,
      title: key,
      last_update: iso(updated),
      link: `https://${key}.example/event`,
      markets: Object.entries(markets).map(([market, rows]) => ({
        key: market,
        last_update: iso(updated),
        outcomes: rows.flatMap(row => pair(...row))
      }))
    }))
  };
}
function game(id, start, live = false) {
  return { id, home_team: `${id} Home`, away_team: `${id} Away`, commence_time: iso(start), live };
}
const nba = bestParlayMarkets.basketball_nba;
function build(events, odds, options = {}) {
  const oddsByEvent = new Map(Object.entries(odds).map(([id, data]) => [id, { data, fetchedAt: now }]));
  return buildBestParlay({ events, oddsByEvent, book: "draftkings", markets: nba, ...options });
}

test("each sport's first core market is the one guests can open", () => {
  assert.deepEqual(Object.keys(bestParlayMarkets).sort(), [
    "americanfootball_ncaaf", "americanfootball_nfl", "baseball_mlb", "basketball_nba", "basketball_wnba", "icehockey_nhl"
  ]);
  assert.equal(bestParlayMarkets.basketball_nba[0], "player_points");
  assert.equal(bestParlayMarkets.icehockey_nhl[0], "player_points");
  assert.equal(bestParlayMarkets.baseball_mlb[0], "batter_hits");
  assert.equal(bestParlayMarkets.americanfootball_nfl[0], "player_pass_yds");
  assert.equal(parlayBooks.size, 14);
  assert.ok(parlayBooks.has("williamhill_us") && !parlayBooks.has("pinnacle"));
});

test("the slate is games in progress (latest start first), then starts within 12 hours", () => {
  const slate = selectSlate([
    game("old", now - 6 * hour),
    game("early", now - 4 * hour),
    game("late", now - hour),
    game("soon", now + hour),
    game("tonight", now + 11 * hour),
    game("tomorrow", now + 13 * hour),
    { id: "", commence_time: iso(now) },
    { id: "bad", commence_time: "not a date" }
  ], now);
  assert.equal(slate.scope, "live");
  assert.deepEqual(slate.events.map(event => event.id), ["late", "early", "soon", "tonight"]);
  assert.deepEqual(slate.events.map(event => event.live), [true, true, false, false]);
});

test("with nothing within 12 hours the next slate is used, and the slate is capped", () => {
  const next = selectSlate([game("c", now + 33 * hour), game("a", now + 20 * hour), game("b", now + 25 * hour)], now);
  assert.equal(next.scope, "next");
  assert.deepEqual(next.events.map(event => event.id), ["a", "b"]);
  assert.deepEqual(selectSlate([game("done", now - 7 * hour)], now), { scope: "none", events: [] });
  assert.deepEqual(selectSlate(null, now), { scope: "none", events: [] });
  const busy = selectSlate(Array.from({ length: 12 }, (_, index) => game(`g${index}`, now + (index + 1) * 10 * minute)), now);
  assert.equal(busy.scope, "soon");
  assert.equal(busy.events.length, 8);
  assert.equal(busy.events[0].id, "g0");
});

test("prices for games closer to tip-off are cached for less time", () => {
  assert.equal(propsTtlMs(now - hour, now), 5 * minute);
  assert.equal(propsTtlMs(now + 30 * minute, now), 8 * minute);
  assert.equal(propsTtlMs(now + 3 * hour, now), 15 * minute);
  assert.equal(propsTtlMs(now + 8 * hour, now), 30 * minute);
  assert.equal(propsTtlMs(Number.NaN, now), 5 * minute);
});

test("player names match across accents, punctuation and suffixes", () => {
  assert.equal(normalizePlayerName("Nikola Jokić"), normalizePlayerName("Nikola Jokic"));
  assert.equal(normalizePlayerName("Jaren Jackson Jr."), normalizePlayerName("Jaren Jackson"));
  assert.equal(normalizePlayerName("Gary Payton II"), normalizePlayerName("Gary Payton"));
  assert.equal(normalizePlayerName("D'Angelo Russell"), normalizePlayerName("DAngelo Russell"));
  assert.equal(normalizePlayerName("Shai Gilgeous-Alexander"), normalizePlayerName("Shai Gilgeous Alexander"));
  assert.notEqual(normalizePlayerName("Jalen Williams"), normalizePlayerName("Jaylin Williams"));
  assert.equal(normalizePlayerName(null), "");
});

test("everyone on the injury report is excluded except probable players", () => {
  const injured = injuredPlayers({
    injuries: [
      { name: "LeBron James", status: "Out" },
      { name: "Luka Dončić", status: "Day-To-Day" },
      { name: "Austin Reaves", status: "Probable" },
      { name: "Rui Hachimura", status: "Questionable" }
    ]
  });
  assert.deepEqual([...injured].sort(), ["lebronjames", "lukadoncic", "ruihachimura"]);
  assert.equal(injuredPlayers(null).size, 0);
});

test("a leg is the chosen book's main-line Over, with the chance averaged over every book at that line", () => {
  const result = build([game("g1", now + hour)], {
    g1: eventOdds({
      draftkings: {
        player_points: [["LeBron James", 24.5, 1.8, 2.0], ["LeBron James", 22.5, 1.45, 2.7], ["Austin Reaves", 15.5, 1.9, 1.9]],
        player_rebounds: [["Anthony Davis", 11.5, 1.95, 1.87]]
      },
      fanduel: {
        player_points: [["LeBron James", 24.5, 1.83, 1.95], ["LeBron James", 23.5, 1.7, 2.1]],
        player_rebounds: [["Anthony Davis", 11.5, 1.9, 1.9]]
      }
    })
  });
  // Reaves has a single quote and Davis leans Under, so only LeBron qualifies.
  assert.equal(result.legs.length, 1);
  const [leg] = result.legs;
  const chance = ((1 / 1.8) / (1 / 1.8 + 1 / 2.0) + (1 / 1.83) / (1 / 1.83 + 1 / 1.95)) / 2;
  assert.equal(leg.player, "LeBron James");
  assert.equal(leg.market, "player_points");
  assert.equal(leg.line, 24.5);
  assert.equal(leg.price, 1.8);
  assert.equal(leg.books, 2);
  assert.ok(Math.abs(leg.probability - chance) < 1e-4);
  assert.ok(Math.abs(leg.edge - (1.8 * chance - 1)) < 1e-4);
  assert.equal(leg.link, "https://book.example/slip/LeBron%20James/24.5");
  assert.equal(leg.eventLink, "https://draftkings.example/event");
  assert.deepEqual([leg.eventId, leg.home, leg.away, leg.live], ["g1", "g1 Home", "g1 Away", false]);
  assert.equal(result.bookGames, 1);
  assert.equal(result.pricesAt, iso(now));
  assert.ok(!("score" in leg));
});

test("long shots, heavy favourites and prices far below fair are left out", () => {
  const [fav, favUnder] = prices(0.8);
  const [dog, dogUnder] = prices(0.27);
  const result = build([game("g1", now + hour)], {
    g1: eventOdds({
      draftkings: {
        player_points: [["Favourite", 8.5, 1.2, 4.5], ["Long Shot", 30.5, 3.8, 1.25], ["Short Price", 10.5, 1.6, 2.3]],
        player_rebounds: [["Fair Leg", 9.5, ...prices(0.56)]]
      },
      fanduel: {
        player_points: [["Favourite", 8.5, fav, favUnder], ["Long Shot", 30.5, dog, dogUnder], ["Short Price", 10.5, 2.0, 1.8]],
        player_rebounds: [["Fair Leg", 9.5, ...prices(0.56)]]
      }
    })
  });
  assert.deepEqual(result.legs.map(leg => leg.player), ["Fair Leg"]);
});

test("stale quotes don't count towards the consensus or the chosen book's price", () => {
  const fresh = eventOdds({ draftkings: { player_points: [["Fresh Book", 20.5, ...prices(0.58)]] } });
  const stale = eventOdds({ fanduel: { player_points: [["Fresh Book", 20.5, ...prices(0.58)]] } }, now - 30 * minute);
  const odds = { bookmakers: [...fresh.bookmakers, ...stale.bookmakers] };
  assert.equal(build([game("g1", now + hour)], { g1: odds }).legs.length, 0);

  const staleTarget = eventOdds({ draftkings: { player_points: [["Old Price", 20.5, ...prices(0.58)]] } }, now - 30 * minute);
  const others = eventOdds({
    fanduel: { player_points: [["Old Price", 20.5, ...prices(0.58)]] },
    betmgm: { player_points: [["Old Price", 20.5, ...prices(0.58)]] }
  });
  const result = build([game("g1", now + hour)], { g1: { bookmakers: [...staleTarget.bookmakers, ...others.bookmakers] } });
  assert.equal(result.legs.length, 0);
  assert.equal(result.bookGames, 1);
});

test("injured players are skipped and counted", () => {
  const rows = [["LeBron James", 24.5, ...prices(0.6)], ["Austin Reaves", 15.5, ...prices(0.55)]];
  const result = build([game("g1", now + hour)], {
    g1: eventOdds({ draftkings: { player_points: rows }, fanduel: { player_points: rows } })
  }, { injured: injuredPlayers({ injuries: [{ name: "LeBron James", status: "Out" }, { name: "Austin Reaves", status: "Probable" }] }) });
  assert.deepEqual(result.legs.map(leg => leg.player), ["Austin Reaves"]);
  assert.equal(result.injuredSkipped, 1);
});

test("one leg per player, spread across games strongest first", () => {
  const both = markets => eventOdds({ draftkings: markets, fanduel: markets });
  const odds = {
    g1: both({
      player_points: [["A One", 20.5, ...prices(0.6)], ["A Two", 12.5, ...prices(0.58)]],
      player_rebounds: [["A One", 7.5, ...prices(0.62)]]
    }),
    g2: both({ player_points: [["B One", 18.5, ...prices(0.55)], ["B Two", 9.5, ...prices(0.53)]] }),
    g3: both({ player_assists: [["C One", 6.5, ...prices(0.57)]] })
  };
  const events = [game("g1", now + hour), game("g2", now + 2 * hour), game("g3", now + 3 * hour)];
  const result = build(events, odds);
  assert.deepEqual(result.legs.map(leg => leg.player), ["A One", "C One", "B One", "A Two", "B Two"]);
  assert.equal(result.legs[0].market, "player_rebounds");
  assert.deepEqual(build(events, odds, { maxLegs: 4 }).legs.map(leg => leg.player), ["A One", "C One", "B One", "A Two"]);
  // Guests only get the first market, so the assists-only game drops out.
  const guest = build(events, odds, { markets: [nba[0]] });
  assert.deepEqual(guest.legs.map(leg => leg.player), ["A One", "B One", "A Two", "B Two"]);
  assert.equal(guest.legs[0].market, "player_points");
  assert.equal(guest.bookGames, 2);
});

test("games the book hasn't priced are skipped and unsafe links are dropped", () => {
  const rows = [["Safe Link", 20.5, ...prices(0.6), "javascript:alert(1)"]];
  const result = build([game("g1", now + hour), game("g2", now + hour)], {
    g1: eventOdds({ draftkings: { player_points: rows }, fanduel: { player_points: rows } }),
    g2: eventOdds({ fanduel: { player_points: [["Other Book", 20.5, ...prices(0.6)]] } })
  });
  assert.equal(result.bookGames, 1);
  assert.equal(result.legs.length, 1);
  assert.equal(result.legs[0].link, "");
  assert.equal(result.legs[0].eventLink, "https://draftkings.example/event");
  assert.deepEqual(build([game("g1", now)], {}).legs, []);
  assert.equal(build([game("g1", now)], {}).pricesAt, "");
});

test("games past their listed start that haven't begun wait with the upcoming games", () => {
  const slate = selectSlate([game("late-tip", now - 10 * minute), game("on", now - hour), game("soon", now + hour)], now, 8,
    new Set(["late-tip"]));
  assert.equal(slate.scope, "live");
  assert.deepEqual(slate.events.map(event => [event.id, event.live]), [["on", true], ["late-tip", false], ["soon", false]]);
  const waiting = selectSlate([game("late-tip", now - 10 * minute), game("tonight", now + 3 * hour)], now, 8, new Set(["late-tip"]));
  assert.equal(waiting.scope, "soon");
  assert.deepEqual(waiting.events.map(event => [event.id, event.live]), [["late-tip", false], ["tonight", false]]);
});

// ---- Live reads ----

const hoopsLabels = ["MIN", "PTS", "FG", "3PT", "FT", "REB", "AST", "TO", "STL", "BLK", "OREB", "DREB", "PF", "+/-"];
// A box-score entry as /api/live-game returns it.
function hooper(name, numbers = {}, details = {}) {
  const values = { MIN: 0, PTS: 0, FG: "0-0", REB: 0, AST: 0, PF: 0, ...numbers };
  return {
    id: name, name, position: "G", starter: true, starterConfirmed: true, onCourt: true, ...details,
    stats: hoopsLabels.map(label => ({ label, value: String(values[label] ?? "0") }))
  };
}
const side = (abbreviation, score, players) => ({ abbreviation, score: String(score), players });
const hoopsGame = (period, clock, teams, periodLabel = `${clock} - ${period}`) => ({ state: "in", period, clock, periodLabel, teams });
const nbaRead = (game, player, line = 25.5, market = "player_points") =>
  liveRead({ sport: "basketball_nba", market, line, player, game });

test("the live clock reads quarters, periods, innings and breaks", () => {
  const nbaClock = (period, clock, periodLabel = "") => liveClock("basketball_nba", { state: "in", period, clock, periodLabel });
  assert.deepEqual(nbaClock(3, "5:42", "5:42 - 3rd"), { label: "Q3 5:42", left: 17.7, unit: "min", progress: 0.63, late: false });
  assert.deepEqual([nbaClock(2, "0.0", "Halftime").label, nbaClock(2, "0.0", "Halftime").left], ["Halftime", 24]);
  assert.equal(nbaClock(1, "0.0", "End of 1st").label, "End of Q1");
  assert.deepEqual([nbaClock(4, "45.3").left, nbaClock(4, "45.3").late, nbaClock(4, "4:00").late], [0.8, true, false]);
  assert.deepEqual(nbaClock(6, "1:05"), { label: "2OT 1:05", left: 0, unit: "min", progress: 1, late: true });
  assert.equal(nbaClock(5, "3:00").label, "OT 3:00");
  assert.equal(liveClock("basketball_wnba", { state: "in", period: 1, clock: "10:00" }).left, 40);
  assert.deepEqual(liveClock("icehockey_nhl", { state: "in", period: 2, clock: "12:34" }),
    { label: "P2 12:34", left: 32.6, unit: "min", progress: 0.46, late: false });
  assert.equal(liveClock("americanfootball_nfl", { state: "in", period: 2, clock: "0:00", periodLabel: "Halftime" }).left, 30);
  const mlbClock = (period, periodLabel) => liveClock("baseball_mlb", { state: "in", period, periodLabel });
  assert.deepEqual(mlbClock(5, "Top 5th"), { label: "Top 5th", left: 5, unit: "inn", progress: 0.44, late: false });
  assert.deepEqual([mlbClock(3, "Mid 3rd").left, mlbClock(8, "End 8th").late, mlbClock(11, "Top 11th").left], [6.5, true, 0]);
  assert.equal(liveClock("basketball_nba", { state: "pre", period: 0, clock: "0.0" }), null);
  assert.equal(liveClock("soccer_epl", { state: "in", period: 1, clock: "10:00" }), null);
});

test("a live read shows his numbers, pace, fouls, minutes, bench competition and the score", () => {
  const game = hoopsGame(2, "0.0", [
    side("NYK", 58, [
      hooper("Jalen Brunson", { MIN: 20, PTS: 18, FG: "7-12", PF: 1 }, { onCourt: false }),
      hooper("Miles McBride", { MIN: 8, PTS: 4 }, { starter: false }),
      hooper("Mitchell Robinson", { MIN: 14, REB: 6 }, { position: "C" })
    ]),
    side("PHI", 55, [hooper("Tyrese Maxey", { MIN: 21, PTS: 15, PF: 2 })])
  ], "Halftime");
  const { read, bonus } = nbaRead(game, "Jalen Brunson");
  assert.deepEqual([read.clock, read.leftText, read.unit, read.progress], ["Halftime", "24 min left", "min", 0.5]);
  assert.deepEqual([read.team, read.teamScore, read.opponent, read.opponentScore], ["NYK", 58, "PHI", 55]);
  assert.deepEqual([read.stat, read.current, read.need], ["PTS", 18, 8]);
  assert.deepEqual([read.minutes, read.fouls, read.starter, read.onCourt, read.bench, read.position], [20, 1, true, false, 1, "G"]);
  assert.equal(read.pace, "hot");
  assert.ok(read.projected > 30 && read.projected < 36);
  assert.deepEqual(read.notes.map(note => note.text), [
    `18 PTS in 20 min — ahead of pace, heading for about ${Math.round(read.projected)} (line 25.5)`,
    "Shooting 7 of 12 from the field (58%)",
    "Only 1 personal foul",
    "Starter: 20 of 24 minutes so far, resting now",
    "1 bench guard has played",
    "Close game, NYK up 3 — starters stay on the floor"
  ]);
  assert.ok(bonus > 0.05);

  const maxey = nbaRead(game, "Tyrese Maxey", 22.5).read;
  assert.deepEqual(maxey.notes.slice(1).map(note => note.text), [
    "2 personal fouls — not in foul trouble",
    "Starter: 21 of 24 minutes so far, on the floor now",
    "No bench guard has played — little competition for his minutes",
    "Close game, PHI down 3 — starters stay on the floor"
  ]);

  const early = nbaRead(hoopsGame(1, "9:00", [side("DEN", 8, [hooper("Nikola Jokic", { MIN: 3, REB: 2 }, { position: "C" })]), side("PHX", 6, [])]),
    "Nikola Jokic", 11.5, "player_rebounds");
  assert.equal(early.read.pace, "early");
  assert.deepEqual(early.read.notes.slice(0, 3).map(note => note.text),
    ["2 REB in 3 min — early, his pace is still settling", "No personal fouls", "Starter, on the floor now"]);

  // Bench guards who have played only count against him while he isn't getting most of the minutes.
  const rotation = minutes => nbaRead(hoopsGame(2, "0.0", [
    side("NYK", 58, [
      hooper("Jalen Brunson", { MIN: minutes, PTS: 18 }),
      ...["Miles McBride", "Tyler Kolek", "Landry Shamet"].map(name => hooper(name, { MIN: 6 }, { starter: false }))
    ]),
    side("PHI", 55, [])
  ], "Halftime"), "Jalen Brunson");
  const busy = rotation(20);
  const sharing = rotation(14);
  assert.deepEqual([busy.read.bench, busy.read.notes[3]],
    [3, { tone: "neutral", text: "3 bench guards have played, but he is getting most of the minutes" }]);
  assert.deepEqual(sharing.read.notes[3], { tone: "warn", text: "3 bench guards have played — more competition for minutes" });
  assert.ok(busy.bonus > sharing.bonus);
});

test("players in foul trouble, on short minutes, in a blowout, behind the pace or out of time are left out", () => {
  const at = (period, clock, player, scores = [50, 48], label) =>
    hoopsGame(period, clock, [side("BOS", scores[0], [player]), side("MIA", scores[1], [])], label);
  const tatum = numbers => hooper("Jayson Tatum", numbers, { position: "F" });
  // Two fouls in the 1st quarter, three in the 2nd; at the end of a quarter the next quarter's limit applies.
  assert.deepEqual(nbaRead(at(1, "4:00", tatum({ MIN: 8, PTS: 6, PF: 2 })), "Jayson Tatum"), { skip: "fouls" });
  assert.deepEqual(nbaRead(at(2, "6:00", tatum({ MIN: 14, PTS: 12, PF: 3 })), "Jayson Tatum"), { skip: "fouls" });
  assert.equal(nbaRead(at(1, "0.0", tatum({ MIN: 10, PTS: 9, PF: 2 }), undefined, "End of 1st"), "Jayson Tatum").read.fouls, 2);
  const oneAway = nbaRead(at(3, "6:00", tatum({ MIN: 24, PTS: 22, PF: 3 })), "Jayson Tatum").read;
  assert.deepEqual(oneAway.notes[1], { tone: "warn", text: "3 personal fouls — one more puts him in foul trouble" });
  // Short minutes: a bench player who has barely played, or a starter who has sat most of the game.
  assert.deepEqual(nbaRead(at(2, "0.0", hooper("Payton Pritchard", { MIN: 4, PTS: 2 }, { starter: false }), undefined, "Halftime"),
    "Payton Pritchard", 8.5), { skip: "minutes" });
  assert.deepEqual(nbaRead(at(3, "6:00", tatum({ MIN: 2, PTS: 2 })), "Jayson Tatum"), { skip: "minutes" });
  assert.deepEqual(nbaRead(at(4, "8:00", tatum({ MIN: 30, PTS: 24 }), [110, 88]), "Jayson Tatum"), { skip: "blowout" });
  assert.deepEqual(nbaRead(at(3, "6:00", tatum({ MIN: 26, PTS: 22 }), [90, 64]), "Jayson Tatum"), { skip: "blowout" });
  assert.deepEqual(nbaRead(at(2, "0.0", tatum({ MIN: 20, PTS: 6 }), undefined, "Halftime"), "Jayson Tatum"), { skip: "behind" });
  assert.deepEqual(nbaRead(at(3, "6:00", tatum({ MIN: 26, PTS: 26 })), "Jayson Tatum"), { skip: "decided" });
  assert.deepEqual(nbaRead(at(4, "2:00", tatum({ MIN: 34, PTS: 22 })), "Jayson Tatum"), { skip: "late" });
  assert.deepEqual(nbaRead(at(2, "6:00", tatum({ MIN: 14, PTS: 10 })), "Jaylen Brown"), { skip: "unverified" });
  assert.deepEqual(nbaRead(at(2, "6:00", { ...tatum(), stats: [{ label: "MIN", value: "14" }] }), "Jayson Tatum"), { skip: "unverified" });
  assert.deepEqual(nbaRead({ ...at(2, "6:00", tatum({ MIN: 14 })), state: "pre" }, "Jayson Tatum"), { skip: "unverified" });
});

test("box-score names match the odds feed by surname and first initial when only one player fits", () => {
  const game = hoopsGame(2, "6:00", [
    side("OKC", 40, [
      hooper("Nicolas Claxton", { MIN: 12, REB: 6 }, { position: "C" }),
      hooper("Jalen Williams", { MIN: 14, PTS: 12 }),
      hooper("Jaylin Williams", { MIN: 9, PTS: 5 }, { starter: false, position: "F" })
    ]),
    side("DET", 38, [])
  ]);
  assert.equal(nbaRead(game, "Nic Claxton", 8.5, "player_rebounds").read.current, 6);
  assert.equal(nbaRead(game, "Jalen Williams", 18.5).read.current, 12);
  assert.deepEqual(nbaRead(game, "Jay Williams", 18.5), { skip: "unverified" });
});

test("hockey, baseball and football reads pace the line over what is left of the game", () => {
  const skater = (name, values) => ({
    id: name, name, position: "C", starter: true, onCourt: true,
    stats: ["G", "A", "S", "TOI"].map((label, index) => ({ label, value: String(values[index]) }))
  });
  const hockey = { state: "in", period: 2, clock: "10:00", periodLabel: "10:00 - 2nd", teams: [
    side("TOR", 2, [skater("Auston Matthews", [1, 0, 3, "12:41"])]),
    side("MTL", 1, [skater("Nick Suzuki", [0, 1, 1, "13:02"])])
  ] };
  const shots = liveRead({ sport: "icehockey_nhl", market: "player_shots_on_goal", line: 3.5, player: "Auston Matthews", game: hockey });
  assert.deepEqual([shots.read.clock, shots.read.leftText, shots.read.pace], ["P2 10:00", "30 min left", "hot"]);
  assert.deepEqual(shots.read.notes.map(note => note.text), [
    `3 SOG so far — ahead of pace, heading for about ${Math.round(shots.read.projected)} (line 3.5)`,
    "12:41 time on ice",
    "Close game, TOR up 1"
  ]);
  assert.ok(shots.bonus > 0);
  // A low line hangs on a single play, so it gets no pace verdict.
  const points = liveRead({ sport: "icehockey_nhl", market: "player_points", line: 1.5, player: "Nick Suzuki", game: hockey });
  assert.deepEqual([points.read.current, points.read.pace, points.bonus], [1, "open", 0]);
  assert.equal(points.read.notes[0].text, "1 PTS so far — needs 1 more with 30 min left");

  const mlbPlayer = (name, group, labels, values) => ({
    id: name, name, position: "", starter: true, onCourt: false,
    stats: labels.map((label, index) => ({ label: `${group} ${label}`, value: String(values[index]) }))
  });
  const batter = (name, values) => mlbPlayer(name, "Batting", ["H", "R", "RBI"], values);
  const pitcher = (name, values) => mlbPlayer(name, "Pitching", ["IP", "K"], values);
  const baseball = { state: "in", period: 5, clock: "", periodLabel: "Mid 5th", teams: [
    side("LAD", 3, [batter("Mookie Betts", [0, 0, 0]), pitcher("Tyler Glasnow", ["5.0", 6])]),
    side("NYY", 1, [batter("Aaron Judge", [1, 1, 1]), pitcher("Gerrit Cole", ["4.1", 5]), pitcher("Luke Weaver", ["0.2", 1])])
  ] };
  const mlbRead = (market, line, player) => liveRead({ sport: "baseball_mlb", market, line, player, game: baseball });
  const hits = mlbRead("batter_hits", 0.5, "Mookie Betts");
  assert.deepEqual([hits.read.clock, hits.read.pace, hits.read.notes[0].text], ["Mid 5th", "open", "0 H so far — needs 1 more with 4½ innings left"]);
  assert.equal(mlbRead("batter_hits_runs_rbis", 3.5, "Aaron Judge").read.current, 3);
  assert.deepEqual(mlbRead("batter_hits_runs_rbis", 2.5, "Aaron Judge"), { skip: "decided" });
  // A starter no longer listed last among his team's pitchers has been pulled.
  assert.deepEqual(mlbRead("pitcher_strikeouts", 5.5, "Gerrit Cole"), { skip: "removed" });
  const strikeouts = mlbRead("pitcher_strikeouts", 6.5, "Tyler Glasnow");
  assert.deepEqual([strikeouts.read.pace, strikeouts.read.notes[1].text], ["on", "Still on the mound after 5.0 innings"]);

  const football = { state: "in", period: 4, clock: "9:00", periodLabel: "9:00 - 4th", teams: [
    side("KC", 38, [{ id: "15", name: "Patrick Mahomes", position: "QB", starter: true, stats: [{ label: "passing YDS", value: "268" }] }]),
    side("LV", 10, [])
  ] };
  assert.deepEqual(liveRead({ sport: "americanfootball_nfl", market: "player_pass_yds", line: 285.5, player: "Patrick Mahomes", game: football }),
    { skip: "blowout" });
});

test("live games are read live: in-play lines, one book can stand alone, and players in form rank first", () => {
  const liveGames = new Map([["g1", hoopsGame(2, "0.0", [
    side("NYK", 58, [
      hooper("Jalen Brunson", { MIN: 20, PTS: 18, FG: "7-12" }),
      hooper("Josh Hart", { MIN: 19, REB: 7, PF: 2 }, { position: "F" }),
      hooper("Karl-Anthony Towns", { MIN: 18, PTS: 6, REB: 4, PF: 1 }, { position: "C" })
    ]),
    side("PHI", 55, [hooper("Joel Embiid", { MIN: 17, PTS: 14, PF: 4 }, { position: "C" })])
  ], "Halftime")]]);
  const markets = {
    player_points: [["Jalen Brunson", 25.5, ...prices(0.55)], ["Karl-Anthony Towns", 22.5, ...prices(0.56)], ["Joel Embiid", 28.5, ...prices(0.57)]],
    player_rebounds: [["Josh Hart", 11.5, ...prices(0.56)], ["Karl-Anthony Towns", 9.5, ...prices(0.54)]]
  };
  const options = { sport: "basketball_nba", liveGames };
  const liveOdds = updated => ({ g1: eventOdds({ draftkings: markets }, updated) });
  const result = build([game("g1", now - hour, true)], liveOdds(now - 3 * minute), options);
  // Hart's market chance is a little higher, but Brunson has more in hand, no fouls and bigger minutes.
  assert.deepEqual(result.legs.map(leg => leg.player), ["Jalen Brunson", "Josh Hart"]);
  assert.ok(result.legs.every(leg => leg.live && leg.books === 1 && leg.read));
  assert.deepEqual([result.legs[0].read.current, result.legs[0].read.fouls, result.legs[0].read.pace], [18, 0, "hot"]);
  assert.equal(result.liveChecked, 4);
  assert.deepEqual(result.liveSkipped, { behind: 1, fouls: 1 });
  // In-play lines more than a few minutes old are frozen or suspended.
  assert.equal(build([game("g1", now - hour, true)], liveOdds(now - 8 * minute), options).legs.length, 0);
  // Without a box score a leg can't be checked.
  const unchecked = build([game("g1", now - hour, true)], liveOdds(now - minute), { ...options, liveGames: new Map() });
  assert.deepEqual([unchecked.legs.length, unchecked.liveSkipped.unverified], [0, 4]);
  // Pre-game builds are unchanged: two books, no live read.
  const pregame = build([game("g1", now + hour)], { g1: eventOdds({ draftkings: markets, fanduel: markets }) });
  assert.ok(pregame.legs.length > 0 && pregame.legs.every(leg => !("read" in leg)));
  assert.ok(!("liveChecked" in pregame));
});
