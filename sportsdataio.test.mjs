import assert from "node:assert/strict";
import { test } from "node:test";
import { createSportsDataIO, normalizeSportsDataIOMarkets, sportsDataIOApiKey } from "./sportsdataio.mjs";

const now = Date.parse("2026-03-08T12:00:00Z");
const event = {
  GameID: 202,
  ScoreID: 101,
  BettingEventID: 303,
  GameStartTime: "2026-03-08T15:00:00",
  HomeTeamName: "Home",
  AwayTeamName: "Away",
  BettingEventType: "Game"
};
const competitions = [
  { CompetitionId: 99, Name: "Premier League", Key: "EPL" },
  { CompetitionId: 100, Name: "La Liga", Key: "LaLiga" },
  { CompetitionId: 101, Name: "Serie A", Key: "SerieA" },
  { CompetitionId: 102, Name: "Bundesliga", Key: "Bundesliga" },
  { CompetitionId: 103, Name: "Ligue 1", Key: "Ligue1" },
  { CompetitionId: 104, Name: "Major League Soccer", Key: "MLS" },
  { CompetitionId: 105, Name: "UEFA Champions League", Key: "UEFAChampionsLeague" }
];

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function mockProvider(handler = () => []) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: new URL(url), options });
    return response(await handler(new URL(url), options));
  };
  return { calls, fetchImpl };
}

test("SportsDataIO schedule routes cover every configured league and collapse soccer competition lookups", async () => {
  const { calls, fetchImpl } = mockProvider(url => {
    if (url.pathname === "/v4/soccer/scores/JSON/Competitions") return competitions;
    if (/BettingEventsByDate/.test(url.pathname)) return [event];
    return [];
  });
  const client = createSportsDataIO({ apiKey: "test-key", fetchImpl, now: () => now, logger: null });
  const sports = await client.request("sports/");
  assert.equal(sports.length, 13);

  const expectedRoutes = [
    ["americanfootball_nfl", "/v3/nfl/odds/JSON/BettingEventsByDate/"],
    ["americanfootball_ncaaf", "/v3/cfb/odds/JSON/BettingEventsByDate/"],
    ["basketball_nba", "/v3/nba/odds/JSON/BettingEventsByDate/"],
    ["basketball_wnba", "/v3/wnba/scores/JSON/BettingEventsByDate/"],
    ["baseball_mlb", "/v3/mlb/odds/JSON/BettingEventsByDate/"],
    ["icehockey_nhl", "/v3/nhl/odds/JSON/BettingEventsByDate/"],
    ["soccer_epl", "/v4/soccer/odds/JSON/BettingEventsByDate/99/"],
    ["soccer_spain_la_liga", "/v4/soccer/odds/JSON/BettingEventsByDate/100/"],
    ["soccer_italy_serie_a", "/v4/soccer/odds/JSON/BettingEventsByDate/101/"],
    ["soccer_germany_bundesliga", "/v4/soccer/odds/JSON/BettingEventsByDate/102/"],
    ["soccer_france_ligue_one", "/v4/soccer/odds/JSON/BettingEventsByDate/103/"],
    ["soccer_usa_mls", "/v4/soccer/odds/JSON/BettingEventsByDate/104/"],
    ["soccer_uefa_champs_league", "/v4/soccer/odds/JSON/BettingEventsByDate/105/"]
  ];

  for (const [sport, route] of expectedRoutes) {
    const listed = await client.request(`sports/${sport}/events/`);
    assert.equal(listed.length, 1, sport);
    assert.equal(listed[0].sport_key, sport);
    assert.ok(calls.some(call => call.url.pathname.startsWith(route)), sport);
  }
  assert.equal(calls.filter(call => call.url.pathname === "/v4/soccer/scores/JSON/Competitions").length, 1);
});

test("SportsDataIO converts Eastern wall times through both DST offsets and rejects a nonexistent time", async () => {
  const fixtures = new Map([
    ["2026-03-08T03:30:00", "2026-03-08T07:30:00.000Z"],
    ["2026-11-01T01:30:00", "2026-11-01T06:30:00.000Z"],
    ["2026-03-08T02:30:00", ""]
  ]);
  for (const [input, expected] of fixtures) {
    const { fetchImpl } = mockProvider(url => {
      if (/BettingEventsByDate/.test(url.pathname)) return [{ ...event, GameStartTime: input }];
      return [];
    });
    const client = createSportsDataIO({ apiKey: "test-key", fetchImpl, now: () => now, logger: null });
    const listed = await client.request("sports/basketball_nba/events/");
    assert.equal(listed[0]?.commence_time || "", expected);
  }
});

test("SportsDataIO normalizes main and alternate prop outcomes, decimal prices and sportsbook filters", () => {
  const markets = normalizeSportsDataIOMarkets("americanfootball_nfl", [
    {
      BettingMarketType: "Player Prop",
      BettingBetType: "Passing Yards",
      PlayerName: "Quarterback",
      Updated: "2026-03-08T14:00:00Z",
      BettingOutcomes: [
        { SportsBook: { Name: "DraftKings" }, BettingOutcomeType: "Over", Value: 249.5, PayoutAmerican: -110 },
        { SportsBook: { Name: "DraftKings" }, BettingOutcomeType: "Under", Value: 249.5, PayoutDecimal: 1.95 },
        { SportsBook: { Name: "FanDuel" }, BettingOutcomeType: "Over", Value: 249.5, PayoutDecimal: 1.9, IsAlternate: true },
        { SportsBook: { Name: "DraftKings" }, BettingOutcomeType: "Over", Value: 250.5, PayoutDecimal: 1.9, IsAvailable: false }
      ]
    }
  ], "player_pass_yds,player_pass_yds_alternate", "draftkings");

  assert.equal(markets.length, 1);
  assert.equal(markets[0].key, "draftkings");
  assert.deepEqual(markets[0].markets.map(market => market.key), ["player_pass_yds"]);
  assert.deepEqual(markets[0].markets[0].outcomes.map(outcome => outcome.name), ["Over", "Under"]);
  assert.equal(markets[0].markets[0].outcomes[0].description, "Quarterback");
  assert.ok(Math.abs(markets[0].markets[0].outcomes[0].price - 1.90909) < 0.0001);

  const alternate = normalizeSportsDataIOMarkets("americanfootball_nfl", [{
    BettingMarketType: "Player Prop",
    BettingBetType: "Passing Yards",
    PlayerName: "Quarterback",
    BettingOutcomes: [{ SportsBook: { Name: "FanDuel" }, BettingOutcomeType: "Over", Value: 200.5, PayoutDecimal: 1.8, IsAlternate: true }]
  }], "player_pass_yds_alternate", "fanduel");
  assert.equal(alternate[0].markets[0].key, "player_pass_yds_alternate");
});

test("SportsDataIO uses the subscription header and the correct NFL, CFB and WNBA player-prop routes", async () => {
  const { calls, fetchImpl } = mockProvider(url => {
    if (/BettingEventsByDate/.test(url.pathname)) return [event];
    if (/BettingPlayerPropsBy/.test(url.pathname)) return [];
    return [];
  });
  const client = createSportsDataIO({ apiKey: "test-key", fetchImpl, now: () => now, logger: null });
  const routes = [
    ["americanfootball_nfl", "101", "/v3/nfl/odds/JSON/BettingPlayerPropsByScoreID/101"],
    ["americanfootball_ncaaf", "202", "/v3/cfb/odds/JSON/BettingPlayerPropsByGameID/202"],
    ["basketball_wnba", "202", "/v3/wnba/scores/JSON/BettingPlayerPropsByGameID/202"]
  ];
  for (const [sport, id, route] of routes) {
    await client.request(`sports/${sport}/events/`);
    await client.request(`sports/${sport}/events/${id}/odds/`, { markets: "player_points" });
    assert.ok(calls.some(call => call.url.pathname === route), route);
  }
  assert.ok(calls.every(call => call.options.headers["Ocp-Apim-Subscription-Key"] === "test-key"));
  assert.ok(calls.every(call => !call.url.href.includes("test-key")));
});

test("SportsDataIO event odds retain the common event shape and use the betting-event identifier", async () => {
  const { calls, fetchImpl } = mockProvider(url => {
    if (/BettingEventsByDate/.test(url.pathname)) return [event];
    if (url.pathname.endsWith("/BettingMarkets/303")) return [{
      BettingMarketType: "Game Line",
      BettingBetType: "Moneyline",
      BettingOutcomes: [
        { SportsBook: { Name: "DraftKings" }, BettingOutcomeType: "Home", Participant: "Home", PayoutAmerican: -110 },
        { SportsBook: { Name: "DraftKings" }, BettingOutcomeType: "Away", Participant: "Away", PayoutAmerican: 100 }
      ]
    }];
    return [];
  });
  const client = createSportsDataIO({ apiKey: "test-key", fetchImpl, now: () => now, logger: null });
  const result = await client.request("sports/basketball_nba/events/202/odds/", { markets: "h2h" });
  assert.equal(result.id, "202");
  assert.equal(result.commence_time, "2026-03-08T19:00:00.000Z");
  assert.equal(result.bookmakers[0].key, "draftkings");
  assert.deepEqual(result.bookmakers[0].markets[0].outcomes.map(outcome => outcome.name), ["Home", "Away"]);
  assert.ok(calls.some(call => call.url.pathname === "/v3/nba/odds/JSON/BettingMarkets/303"));
});

test("SportsDataIO key prefers SPORTSDATAIO_API_KEY and falls back to THE_ODDS_API_KEY", () => {
  assert.equal(sportsDataIOApiKey({ SPORTSDATAIO_API_KEY: " primary ", THE_ODDS_API_KEY: "legacy" }), "primary");
  assert.equal(sportsDataIOApiKey({ SPORTSDATAIO_API_KEY: "  ", THE_ODDS_API_KEY: " legacy\n" }), "legacy");
  assert.equal(sportsDataIOApiKey({ THE_ODDS_API_KEY: "legacy" }), "legacy");
  assert.equal(sportsDataIOApiKey({}), "");
});

test("SportsDataIO events use full team names from the teams feed and fall back to team keys", async () => {
  const teamEvent = { GameID: 24073, BettingEventID: 9001, GameStartTime: "2026-03-08T15:30:00", BettingEventType: "Game",
    HomeTeam: "CHI", AwayTeam: "PHI", HomeTeamID: 4, AwayTeamID: 7 };
  const { calls, fetchImpl } = mockProvider(url => {
    if (url.pathname === "/v3/nba/scores/JSON/Teams") return [
      { TeamID: 4, Key: "CHI", City: "Chicago", Name: "Bulls" },
      { TeamID: 7, Key: "PHI", City: "Philadelphia", Name: "76ers" }
    ];
    if (url.pathname === "/v3/cfb/scores/JSON/Teams") return [{ TeamID: 1, Key: "ALA", School: "Alabama", Name: "Crimson Tide" }];
    if (url.pathname === "/v3/nfl/scores/JSON/Teams") return [{ TeamID: 16, Key: "KC", City: "Kansas City", Name: "Chiefs", FullName: "Kansas City Chiefs" }];
    if (url.pathname.startsWith("/v3/cfb/odds/JSON/BettingEventsByDate/")) return [{ ...teamEvent, HomeTeam: "ALA", HomeTeamID: 1, AwayTeam: "UGA", AwayTeamID: 2 }];
    if (url.pathname.startsWith("/v3/nfl/odds/JSON/BettingEventsByDate/")) return [{ ...teamEvent, ScoreID: 55, HomeTeam: "KC", HomeTeamID: 99, AwayTeam: "BUF", AwayTeamID: 98 }];
    if (/BettingEventsByDate/.test(url.pathname)) return [teamEvent];
    return [];
  });
  const client = createSportsDataIO({ apiKey: "test-key", fetchImpl, now: () => now, logger: null });
  const [nba] = await client.request("sports/basketball_nba/events/");
  assert.deepEqual([nba.home_team, nba.away_team], ["Chicago Bulls", "Philadelphia 76ers"]);
  const [cfb] = await client.request("sports/americanfootball_ncaaf/events/");
  assert.deepEqual([cfb.home_team, cfb.away_team], ["Alabama Crimson Tide", "UGA"]);
  const [nfl] = await client.request("sports/americanfootball_nfl/events/");
  assert.equal(nfl.home_team, "Kansas City Chiefs");
  assert.equal(calls.filter(call => call.url.pathname === "/v3/nba/scores/JSON/Teams").length, 1);

  const warnings = [];
  const denied = createSportsDataIO({ apiKey: "test-key", now: () => now, logger: { warn: (...args) => warnings.push(args.join(" ")) },
    fetchImpl: async url => new URL(url).pathname.endsWith("/Teams") ? response({}, 403) : response([teamEvent]) });
  const [fallback] = await denied.request("sports/basketball_nba/events/");
  assert.deepEqual([fallback.home_team, fallback.away_team], ["CHI", "PHI"]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /team names unavailable/);
  assert.ok(!warnings[0].includes("test-key"));
});

test("SportsDataIO explains denied feeds and logs a key-free outline of odds it cannot price", async () => {
  const deniedClient = createSportsDataIO({ apiKey: "test-key", logger: null, fetchImpl: async () => new Response("", { status: 401 }) });
  await assert.rejects(deniedClient.request("sports/soccer_epl/events/"), error =>
    error.status === 401 && /denied access/.test(error.message) && /plan includes this league/.test(error.message));

  const warnings = [];
  const { fetchImpl } = mockProvider(url => {
    if (/BettingEventsByDate/.test(url.pathname)) return [event];
    if (/BettingPlayerPropsByGameID/.test(url.pathname)) return [{
      BettingMarketType: "Player Prop", BettingBetType: "Mystery Stat", Name: "Mystery Stat", PlayerName: "A Player",
      BettingOutcomes: [{ BettingOutcomeType: "Over", Value: 1.5, PayoutAmerican: 100, SportsBook: { Name: "DraftKings" } }]
    }];
    return [];
  });
  const client = createSportsDataIO({ apiKey: "test-key", fetchImpl, now: () => now,
    logger: { warn: (...args) => warnings.push(args.join(" ")) } });
  await client.request("sports/basketball_nba/events/");
  const result = await client.request("sports/basketball_nba/events/202/odds/", { markets: "player_points" });
  await client.request("sports/basketball_nba/events/202/odds/", { markets: "player_points" });
  assert.deepEqual(result.bookmakers, []);
  const outline = warnings.filter(warning => /props odds for basketball_nba produced no prices/.test(warning));
  assert.equal(outline.length, 1);
  assert.match(outline[0], /"betTypes":\["Mystery Stat"\]/);
  assert.match(outline[0], /"sportsbooks":\["DraftKings"\]/);
  assert.ok(!outline[0].includes("test-key"));
});

test("SportsDataIO reports a missing key and redacts it from provider error messages", async () => {
  const noKey = createSportsDataIO({ fetchImpl: async () => { throw new Error("must not fetch"); } });
  await assert.rejects(noKey.request("sports/basketball_nba/events/"), error =>
    error.status === 503 && /SPORTSDATAIO_API_KEY/.test(error.message));

  const { fetchImpl } = mockProvider(() => ({ Message: "Invalid subscription key: secret-key" }));
  const client = createSportsDataIO({ apiKey: "secret-key", logger: null, fetchImpl: async (url, options) => {
    const result = await fetchImpl(url, options);
    return new Response(JSON.stringify({ Message: "Invalid subscription key: secret-key" }), { status: 401 });
  } });
  await assert.rejects(client.request("sports/basketball_nba/events/"), error =>
    error.status === 401 && !error.message.includes("secret-key") && error.message.includes("[redacted]"));
});
