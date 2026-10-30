import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bestParlayMarkets, buildBestParlay, injuredPlayers, normalizePlayerName, parlayBooks, propsTtlMs, selectSlate
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
