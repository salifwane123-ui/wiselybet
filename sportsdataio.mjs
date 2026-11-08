const apiOrigin = "https://api.sportsdata.io";
const minute = 60_000;

const sports = {
  americanfootball_nfl: { key: "americanfootball_nfl", title: "NFL", league: "nfl", feed: "odds", id: "ScoreID" },
  americanfootball_ncaaf: { key: "americanfootball_ncaaf", title: "NCAA Football", league: "cfb", feed: "odds", id: "GameID" },
  basketball_nba: { key: "basketball_nba", title: "NBA", league: "nba", feed: "odds", id: "GameID" },
  basketball_wnba: { key: "basketball_wnba", title: "WNBA", league: "wnba", feed: "scores", id: "GameID" },
  baseball_mlb: { key: "baseball_mlb", title: "MLB", league: "mlb", feed: "odds", id: "GameID" },
  icehockey_nhl: { key: "icehockey_nhl", title: "NHL", league: "nhl", feed: "odds", id: "GameID" },
  soccer_epl: { key: "soccer_epl", title: "Premier League", competition: ["premier league", "epl"] },
  soccer_spain_la_liga: { key: "soccer_spain_la_liga", title: "La Liga", competition: ["la liga", "laliga", "primera division"] },
  soccer_italy_serie_a: { key: "soccer_italy_serie_a", title: "Serie A", competition: ["serie a", "seriea"] },
  soccer_germany_bundesliga: { key: "soccer_germany_bundesliga", title: "Bundesliga", competition: ["bundesliga"] },
  soccer_france_ligue_one: { key: "soccer_france_ligue_one", title: "Ligue 1", competition: ["ligue 1", "ligue1"] },
  soccer_usa_mls: { key: "soccer_usa_mls", title: "MLS", competition: ["major league soccer", "mls"] },
  soccer_uefa_champs_league: { key: "soccer_uefa_champs_league", title: "UEFA Champions League", competition: ["uefa champions league", "champions league"] }
};

const sportMarkets = {
  basketball_nba: [
    ["player_points_rebounds_assists", /\b(points? rebounds? assists?|pra)\b/],
    ["player_threes", /\b(3[- ]?pointers? made|three[- ]point (field goals? )?made|threes?)\b/],
    ["player_rebounds", /\brebounds?\b/],
    ["player_assists", /\bassists?\b/],
    ["player_blocks", /\bblocks?\b/],
    ["player_steals", /\bsteals?\b/],
    ["player_turnovers", /\bturnovers?\b/],
    ["player_points", /\bpoints?( scored)?\b/]
  ],
  basketball_wnba: [
    ["player_points_rebounds_assists", /\b(points? rebounds? assists?|pra)\b/],
    ["player_threes", /\b(3[- ]?pointers? made|three[- ]point (field goals? )?made|threes?)\b/],
    ["player_rebounds", /\brebounds?\b/],
    ["player_assists", /\bassists?\b/],
    ["player_blocks", /\bblocks?\b/],
    ["player_steals", /\bsteals?\b/],
    ["player_turnovers", /\bturnovers?\b/],
    ["player_points", /\bpoints?( scored)?\b/]
  ],
  icehockey_nhl: [
    ["player_shots_on_goal", /\b(shots? on goal|sog)\b/],
    ["player_total_saves", /\b(goaltender )?(total )?saves?\b/],
    ["player_power_play_points", /\bpower[- ]play points?\b/],
    ["player_points", /\b(points?|goals? \+ assists?)\b/],
    ["player_goals", /\bgoals?\b/],
    ["player_assists", /\bassists?\b/],
    ["player_blocked_shots", /\b(blocked shots?|blocks?)\b/]
  ],
  baseball_mlb: [
    ["batter_hits_runs_rbis", /\b(hits? \+ runs? \+ rbis?|hrr|hits? runs? rbis?)\b/],
    ["batter_total_bases", /\b(total bases?|bases?)\b/],
    ["batter_home_runs", /\bhome runs?\b/],
    ["batter_stolen_bases", /\bstolen bases?\b/],
    ["batter_runs_scored", /\b(runs? scored|batter runs?)\b/],
    ["batter_rbis", /\b(rbis?|runs batted in)\b/],
    ["batter_walks", /\b(batter )?walks?\b/],
    ["pitcher_strikeouts", /\b(pitcher )?(strikeouts?|ks)\b/],
    ["pitcher_hits_allowed", /\b(pitcher )?hits? allowed\b/],
    ["pitcher_earned_runs", /\b(earned runs?|eras?)\b/],
    ["pitcher_outs", /\b(pitcher )?outs?\b/],
    ["batter_hits", /\b(batter )?hits?\b/]
  ],
  americanfootball_nfl: [
    ["player_pass_rush_yds", /\b(pass(ing)? \+ rush(ing)? yards?|pass[- ]?rush yards?)\b/],
    ["player_rush_reception_yds", /\b(rush(ing)? \+ receiv(ing)? yards?|rush[- ]?receiv(ing)? yards?)\b/],
    ["player_anytime_td", /\b(anytime touchdown|to score a touchdown)\b/],
    ["player_pass_yds", /\b(pass(ing)? yards?)\b/],
    ["player_pass_tds", /\b(pass(ing)? touchdowns?|pass tds?)\b/],
    ["player_pass_completions", /\b(completions?|completed passes?)\b/],
    ["player_pass_attempts", /\b(pass(ing)? attempts?)\b/],
    ["player_pass_interceptions", /\b(pass(ing)? interceptions?|interceptions thrown)\b/],
    ["player_rush_yds", /\b(rush(ing)? yards?)\b/],
    ["player_rush_tds", /\b(rush(ing)? touchdowns?|rush tds?)\b/],
    ["player_rush_attempts", /\b(rush(ing)? attempts?)\b/],
    ["player_receptions", /\breceptions?\b/],
    ["player_reception_yds", /\b(receiv(ing)? yards?)\b/],
    ["player_reception_tds", /\b(receiv(ing)? touchdowns?|receiving tds?)\b/]
  ],
  americanfootball_ncaaf: [
    ["player_pass_rush_yds", /\b(pass(ing)? \+ rush(ing)? yards?|pass[- ]?rush yards?)\b/],
    ["player_rush_reception_yds", /\b(rush(ing)? \+ receiv(ing)? yards?|rush[- ]?receiv(ing)? yards?)\b/],
    ["player_anytime_td", /\b(anytime touchdown|to score a touchdown)\b/],
    ["player_pass_yds", /\b(pass(ing)? yards?)\b/],
    ["player_pass_tds", /\b(pass(ing)? touchdowns?|pass tds?)\b/],
    ["player_pass_completions", /\b(completions?|completed passes?)\b/],
    ["player_pass_attempts", /\b(pass(ing)? attempts?)\b/],
    ["player_pass_interceptions", /\b(pass(ing)? interceptions?|interceptions thrown)\b/],
    ["player_rush_yds", /\b(rush(ing)? yards?)\b/],
    ["player_rush_tds", /\b(rush(ing)? touchdowns?|rush tds?)\b/],
    ["player_rush_attempts", /\b(rush(ing)? attempts?)\b/],
    ["player_receptions", /\breceptions?\b/],
    ["player_reception_yds", /\b(receiv(ing)? yards?)\b/],
    ["player_reception_tds", /\b(receiv(ing)? touchdowns?|receiving tds?)\b/]
  ],
  soccer_epl: [
    ["player_shots_on_target", /\bshots? on target\b/],
    ["player_shots", /\bshots?\b/],
    ["player_assists", /\bassists?\b/]
  ],
  soccer_spain_la_liga: [
    ["player_shots_on_target", /\bshots? on target\b/],
    ["player_shots", /\bshots?\b/],
    ["player_assists", /\bassists?\b/]
  ],
  soccer_italy_serie_a: [
    ["player_shots_on_target", /\bshots? on target\b/],
    ["player_shots", /\bshots?\b/],
    ["player_assists", /\bassists?\b/]
  ],
  soccer_germany_bundesliga: [
    ["player_shots_on_target", /\bshots? on target\b/],
    ["player_shots", /\bshots?\b/],
    ["player_assists", /\bassists?\b/]
  ],
  soccer_france_ligue_one: [
    ["player_shots_on_target", /\bshots? on target\b/],
    ["player_shots", /\bshots?\b/],
    ["player_assists", /\bassists?\b/]
  ],
  soccer_usa_mls: [
    ["player_shots_on_target", /\bshots? on target\b/],
    ["player_shots", /\bshots?\b/],
    ["player_assists", /\bassists?\b/]
  ],
  soccer_uefa_champs_league: [
    ["player_shots_on_target", /\bshots? on target\b/],
    ["player_shots", /\bshots?\b/],
    ["player_assists", /\bassists?\b/]
  ]
};

const bookmakerAliases = new Map([
  ["draftkings", "draftkings"], ["fanduel", "fanduel"], ["betmgm", "betmgm"],
  ["williamhill", "williamhill_us"], ["caesars", "williamhill_us"],
  ["espnbet", "espnbet"], ["fanatics", "fanatics"], ["betrivers", "betrivers"],
  ["hardrockbet", "hardrockbet"], ["ballybet", "ballybet"], ["bovada", "bovada"],
  ["betonline", "betonlineag"], ["mybookie", "mybookieag"], ["lowvig", "lowvig"],
  ["betus", "betus"]
]);

const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]/g, "");

function providerKey(name) {
  const key = normalize(name);
  return bookmakerAliases.get(key) || key;
}

function easternDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(date);
}

function addDays(date, count) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}

function parseEasternDate(value) {
  if (!value) return NaN;
  const text = String(value).trim();
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return NaN;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return parsed;
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/.exec(text);
  if (!match) return parsed;
  const [, year, month, date, hour, localMinute, seconds = "0", fraction = "0"] = match;
  const milliseconds = Number((fraction + "00").slice(0, 3));
  const wallTime = Date.UTC(Number(year), Number(month) - 1, Number(date),
    Number(hour), Number(localMinute), Number(seconds), milliseconds);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  });
  let timestamp = wallTime + 5 * 60 * minute;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = formatter.formatToParts(timestamp);
    const part = name => Number(parts.find(item => item.type === name)?.value);
    const localAsUtc = Date.UTC(part("year"), part("month") - 1, part("day"),
      part("hour"), part("minute"), part("second"), milliseconds);
    const adjustment = wallTime - localAsUtc;
    if (adjustment === 0) return timestamp;
    timestamp += adjustment;
  }
  return NaN;
}

function gameId(event, sport) {
  const configured = sports[sport];
  if (configured?.id) return event?.[configured.id] ?? event?.GameID ?? event?.ScoreID ?? event?.BettingEventID;
  return event?.GameID ?? event?.BettingEventID;
}

function eventDate(event) {
  const time = parseEasternDate(event?.GameStartTime || event?.StartDate || event?.DateTime);
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function marketKey(sport, market) {
  const type = String(market?.BettingMarketType || "").toLowerCase();
  const playerMarket = /player|prop/i.test(type) || Boolean(market?.PlayerName || market?.PlayerID);
  const description = `${market?.BettingBetType || ""} ${market?.Name || ""}`.toLowerCase();
  if (playerMarket) {
    for (const [key, pattern] of sportMarkets[sport] || []) {
      if (pattern.test(description)) return key;
    }
    return "";
  }
  if (/money.?line|head.?to.?head|winner/i.test(description)) return "h2h";
  if (/spread|handicap|point line/i.test(description)) return "spreads";
  if (/total|over.?under/i.test(description)) return "totals";
  return "";
}

function decimalPrice(outcome) {
  const decimal = Number(outcome?.PayoutDecimal);
  if (Number.isFinite(decimal) && decimal > 1) return decimal;
  const american = Number(outcome?.PayoutAmerican);
  if (!Number.isFinite(american) || american === 0) return 0;
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

function sportsbookName(outcome) {
  return outcome?.SportsBook?.Name || outcome?.Sportsbook?.Name || "";
}

export function normalizeSportsDataIOMarkets(sport, rawMarkets, requestedMarkets = "", requestedBooks = "") {
  const marketFilter = new Set(String(requestedMarkets || "").split(",").filter(Boolean));
  const bookFilter = new Set(String(requestedBooks || "").split(",").filter(Boolean).map(providerKey));
  const books = new Map();
  for (const market of Array.isArray(rawMarkets) ? rawMarkets : []) {
    const key = marketKey(sport, market);
    if (!key) continue;
    const outcomes = Array.isArray(market.BettingOutcomes) ? market.BettingOutcomes : [];
    for (const outcome of outcomes) {
      if (outcome.IsAvailable === false) continue;
      const name = sportsbookName(outcome);
      if (!name) continue;
      const bookKey = providerKey(name);
      if (bookFilter.size && !bookFilter.has(bookKey)) continue;
      const alternate = outcome.IsAlternate === true;
      const selectedKey = alternate ? `${key}_alternate` : key;
      if (marketFilter.size && !marketFilter.has(selectedKey)) continue;
      const price = decimalPrice(outcome);
      if (!(price > 1)) continue;
      if (!books.has(bookKey)) books.set(bookKey, { key: bookKey, title: name, markets: new Map() });
      const book = books.get(bookKey);
      if (!book.markets.has(selectedKey)) book.markets.set(selectedKey, {
        key: selectedKey, last_update: market.Updated || outcome.Updated || "", outcomes: []
      });
      const prop = key.startsWith("player_") || key.startsWith("batter_") || key.startsWith("pitcher_");
      const selection = String(outcome.BettingOutcomeType || "").trim();
      const participant = String(outcome.Participant || "").trim();
      const side = /^(over|yes)$/i.test(selection) ? "Over"
        : /^(under|no)$/i.test(selection) ? "Under"
          : selection || participant;
      const item = {
        name: side,
        ...(prop ? { description: market.PlayerName || participant } : { description: participant }),
        price
      };
      const point = Number(outcome.Value);
      if (Number.isFinite(point)) item.point = point;
      if (outcome.SportsbookUrl) item.link = outcome.SportsbookUrl;
      book.markets.get(selectedKey).outcomes.push(item);
    }
  }
  return [...books.values()].map(book => ({
    key: book.key,
    title: book.title,
    markets: [...book.markets.values()]
  }));
}

function normalizeEvent(event, sport) {
  const id = gameId(event, sport);
  const commenceTime = eventDate(event);
  if (id === undefined || id === null || !commenceTime ||
      (event.BettingEventType && !/^game$/i.test(event.BettingEventType))) return null;
  return {
    id: String(id),
    sport_key: sport,
    commence_time: commenceTime,
    home_team: event.HomeTeamName || event.HomeTeam || "Home",
    away_team: event.AwayTeamName || event.AwayTeam || "Away"
  };
}

export function createSportsDataIO({ apiKey = "", fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const scheduleCache = new Map();
  const schedulePending = new Map();
  const eventById = new Map();
  let competitions;
  let competitionsAt = 0;
  let competitionPending;

  async function request(path) {
    if (!apiKey) {
      const error = new Error("Set SPORTSDATAIO_API_KEY in the server environment.");
      error.status = 503;
      throw error;
    }
    const result = await fetchImpl(new URL(path, apiOrigin), {
      headers: { Accept: "application/json", "Ocp-Apim-Subscription-Key": apiKey },
      signal: AbortSignal.timeout(15000)
    });
    const text = await result.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch {
      const error = new Error("SportsDataIO returned an invalid JSON response.");
      error.status = 502;
      throw error;
    }
    if (!result.ok) {
      let message = body?.Message || body?.message || body?.error || `SportsDataIO returned HTTP ${result.status}.`;
      message = String(message).replaceAll(apiKey, "[redacted]");
      const error = new Error(message);
      error.status = result.status >= 400 && result.status < 600 ? result.status : 502;
      throw error;
    }
    return body;
  }

  async function soccerCompetitions() {
    if (competitions && now() - competitionsAt < 6 * 60 * 60_000) return competitions;
    if (competitionPending) return competitionPending;
    competitionPending = (async () => {
      const value = await request("/v4/soccer/scores/JSON/Competitions");
      if (!Array.isArray(value)) {
        const error = new Error("SportsDataIO returned an invalid competitions list.");
        error.status = 502;
        throw error;
      }
      competitions = value;
      competitionsAt = now();
      return competitions;
    })().finally(() => {
      competitionPending = undefined;
    });
    return competitionPending;
  }

  async function competitionId(sport) {
    const options = sports[sport]?.competition;
    if (!options) return "";
    const list = await soccerCompetitions();
    const match = list.find(item => options.some(option => normalize(item.Name) === normalize(option) || normalize(item.Key) === normalize(option)));
    if (!match) {
      const error = new Error(`SportsDataIO does not list the configured ${sports[sport].title} competition.`);
      error.status = 502;
      throw error;
    }
    return String(match.CompetitionId);
  }

  async function schedulePath(sport, date) {
    const config = sports[sport];
    if (!config) {
      const error = new Error("SportsDataIO does not support this sport.");
      error.status = 400;
      throw error;
    }
    if (config.competition) {
      const competition = await competitionId(sport);
      return `/v4/soccer/odds/JSON/BettingEventsByDate/${encodeURIComponent(competition)}/${date}`;
    }
    return `/v3/${config.league}/${config.feed}/JSON/BettingEventsByDate/${date}`;
  }

  async function listEvents(sport) {
    const cached = scheduleCache.get(sport);
    if (cached && cached.expires > now()) return cached.events;
    if (schedulePending.has(sport)) return schedulePending.get(sport);
    const pending = (async () => {
      const today = easternDate(new Date(now()));
      const dates = [today, addDays(today, 1)];
      const feeds = await Promise.all(dates.map(async date => {
        const path = await schedulePath(sport, date);
        const result = await request(path);
        if (!Array.isArray(result)) {
          const error = new Error("SportsDataIO returned an invalid events list.");
          error.status = 502;
          throw error;
        }
        return result;
      }));
      const unique = new Map();
      for (const event of feeds.flat()) {
        const normalized = normalizeEvent(event, sport);
        if (!normalized) continue;
        eventById.set(`${sport}:${normalized.id}`, { event, normalized, at: now() });
        unique.set(normalized.id, normalized);
      }
      const events = [...unique.values()].sort((a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time));
      scheduleCache.set(sport, { events, expires: now() + minute });
      return events;
    })().finally(() => {
      if (schedulePending.get(sport) === pending) schedulePending.delete(sport);
    });
    schedulePending.set(sport, pending);
    return pending;
  }

  function oddsRoot(sport) {
    const config = sports[sport];
    return config.competition
      ? `/v4/soccer/odds/JSON/`
      : `/v3/${config.league}/${config.feed}/JSON/`;
  }

  async function loadMarkets(sport, record, wantProps) {
    const config = sports[sport];
    const { event } = record;
    const game = String(gameId(event, sport));
    const eventId = String(event.BettingEventID || "");
    const available = Array.isArray(event.BettingMarkets) ? event.BettingMarkets : [];
    const relevant = available.filter(market => {
      const key = marketKey(sport, market);
      return wantProps ? key.startsWith("player_") || key.startsWith("batter_") || key.startsWith("pitcher_")
        : key === "h2h" || key === "spreads" || key === "totals";
    });
    if (relevant.some(market => market.BettingOutcomes?.length)) return relevant;

    let path;
    if (wantProps) {
      const propId = config.league === "nfl" ? (event.ScoreID ?? event.ScoreId ?? game) : game;
      const route = config.league === "nfl" ? "BettingPlayerPropsByScoreID" : "BettingPlayerPropsByGameID";
      path = config.competition
        ? `${oddsRoot(sport)}${route}/${encodeURIComponent(await competitionId(sport))}/${encodeURIComponent(game)}`
        : `${oddsRoot(sport)}${route}/${encodeURIComponent(String(propId))}`;
    } else {
      if (!eventId) {
        const error = new Error("SportsDataIO did not return a betting event ID for this game.");
        error.status = 502;
        throw error;
      }
      path = config.competition
        ? `${oddsRoot(sport)}BettingMarkets/${encodeURIComponent(await competitionId(sport))}/${encodeURIComponent(eventId)}`
        : `${oddsRoot(sport)}BettingMarkets/${encodeURIComponent(eventId)}`;
    }
    return request(path);
  }

  async function eventOdds(sport, id, parameters = {}) {
    if (!sports[sport]) {
      const error = new Error("SportsDataIO does not support this sport.");
      error.status = 400;
      throw error;
    }
    let record = eventById.get(`${sport}:${id}`);
    if (!record) {
      await listEvents(sport);
      record = eventById.get(`${sport}:${id}`);
    }
    if (!record) {
      const error = new Error("The game list has expired. Refresh the games and try again.");
      error.status = 404;
      throw error;
    }
    const requested = String(parameters.markets || "");
    const marketList = requested.split(",").filter(Boolean);
    const needsProps = !marketList.length || marketList.some(key =>
      key.startsWith("player_") || key.startsWith("batter_") || key.startsWith("pitcher_"));
    const needsGame = !marketList.length || marketList.some(key =>
      !key.startsWith("player_") && !key.startsWith("batter_") && !key.startsWith("pitcher_"));
    const results = await Promise.all([
      ...(needsGame ? [loadMarkets(sport, record, false)] : []),
      ...(needsProps ? [loadMarkets(sport, record, true)] : [])
    ]);
    return {
      id: String(id),
      commence_time: record.normalized.commence_time,
      bookmakers: normalizeSportsDataIOMarkets(sport, results.flat(), requested, parameters.bookmakers || "")
    };
  }

  async function requestProvider(endpoint, parameters = {}) {
    if (endpoint === "sports/") {
      return Object.values(sports).map(({ key, title }) => ({ key, title, active: true }));
    }
    const eventList = /^sports\/([a-z0-9_]+)\/events\/?$/i.exec(endpoint);
    if (eventList) return listEvents(decodeURIComponent(eventList[1]));
    const eventOdds = /^sports\/([a-z0-9_]+)\/events\/([^/]+)\/odds\/?$/i.exec(endpoint);
    if (eventOdds) return eventOddsResult(decodeURIComponent(eventOdds[1]), decodeURIComponent(eventOdds[2]), parameters);
    const error = new Error("This endpoint is not supported by the SportsDataIO adapter.");
    error.status = 501;
    throw error;
  }

  async function eventOddsResult(sport, id, parameters) {
    const result = await eventOdds(sport, id, parameters);
    return { ...result, oddsFetchedAt: new Date(now()).toISOString() };
  }

  return { request: requestProvider };
}
