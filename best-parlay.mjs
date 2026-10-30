// The "Best parlay" at the top of the board: the strongest player-prop Overs at one sportsbook across the games
// in progress and the next few hours. Pure functions only; server.mjs fetches, caches and guards the API quota.

const minute = 60_000;
const hour = 60 * minute;

// Core markets per sport. Each one has a live tracker stat, and the first is the market guests can open.
export const bestParlayMarkets = {
  basketball_nba: ["player_points", "player_rebounds", "player_assists"],
  basketball_wnba: ["player_points", "player_rebounds", "player_assists"],
  icehockey_nhl: ["player_points", "player_shots_on_goal", "player_total_saves"],
  baseball_mlb: ["batter_hits", "batter_hits_runs_rbis", "pitcher_strikeouts"],
  americanfootball_nfl: ["player_pass_yds", "player_rush_yds", "player_reception_yds"],
  americanfootball_ncaaf: ["player_pass_yds", "player_rush_yds", "player_reception_yds"]
};

// The sportsbooks offered in the app's sportsbook pickers.
export const parlayBooks = new Set([
  "draftkings", "fanduel", "betmgm", "williamhill_us", "fanatics", "espnbet", "betrivers",
  "hardrockbet", "ballybet", "bovada", "betonlineag", "mybookieag", "lowvig", "betus"
]);

export const parlayRules = {
  maxLegs: 8,
  maxGames: 8,
  liveWindow: 5 * hour,
  upcomingWindow: 12 * hour,
  staleQuote: 20 * minute,
  minBooks: 2,
  minProbability: 0.5,
  minPrice: 1.25,
  maxPrice: 3.5,
  minEdge: -0.08
};

// Games in progress (latest start first, so games nearly over drop off first), then starts within 12 hours.
// With nothing that close, the next slate: the first upcoming game and everything within 12 hours of it.
export function selectSlate(events, now = Date.now(), limit = parlayRules.maxGames) {
  const games = [];
  for (const event of Array.isArray(events) ? events : []) {
    const start = Date.parse(event?.commence_time);
    if (event?.id && Number.isFinite(start)) games.push({ event, start });
  }
  const live = games
    .filter(game => game.start <= now && now - game.start < parlayRules.liveWindow)
    .sort((a, b) => b.start - a.start);
  const future = games.filter(game => game.start > now).sort((a, b) => a.start - b.start);
  let upcoming = future.filter(game => game.start - now <= parlayRules.upcomingWindow);
  let scope = live.length ? "live" : "soon";
  if (!live.length && !upcoming.length) {
    if (!future.length) return { scope: "none", events: [] };
    upcoming = future.filter(game => game.start - future[0].start <= parlayRules.upcomingWindow);
    scope = "next";
  }
  return {
    scope,
    events: [...live, ...upcoming].slice(0, limit).map(game => ({ ...game.event, live: game.start <= now }))
  };
}

// Prices for games in progress or about to start move fastest; games hours away refresh less often to save quota.
export function propsTtlMs(start, now = Date.now()) {
  const until = Number(start) - now;
  if (!Number.isFinite(until) || until <= 0) return 5 * minute;
  if (until <= hour) return 8 * minute;
  if (until <= 6 * hour) return 15 * minute;
  return 30 * minute;
}

// "Jaren Jackson Jr." and "Jaren Jackson" match, as do accented and unaccented spellings.
export function normalizePlayerName(name) {
  const words = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`.]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  while (words.length > 2 && /^(jr|sr|ii|iii|iv|v)$/.test(words[words.length - 1])) words.pop();
  return words.join("");
}

// Everyone on the injury report except players listed as probable (or active again).
export function injuredPlayers(report) {
  const names = new Set();
  for (const injury of report?.injuries || []) {
    if (/^(probable|active)$/i.test(String(injury?.status || "").trim())) continue;
    const name = normalizePlayerName(injury?.name);
    if (name) names.add(name);
  }
  return names;
}

function httpsLink(value) {
  return typeof value === "string" && /^https:\/\//i.test(value) && value.length <= 2000 ? value : "";
}

function quoteIsFresh(market, bookmaker, fetchedAt) {
  const updated = Date.parse(market?.last_update || bookmaker?.last_update || "");
  return !Number.isFinite(updated) || !Number.isFinite(fetchedAt) || fetchedAt - updated <= parlayRules.staleQuote;
}

// player key -> { player, lines: point -> { over, under } } for one book's market.
function playerLines(market) {
  const players = new Map();
  for (const outcome of market?.outcomes || []) {
    const side = String(outcome?.name || "").toLowerCase();
    const player = String(outcome?.description || "").trim();
    if ((side !== "over" && side !== "under") || !player) continue;
    if (typeof outcome.point !== "number" || !Number.isFinite(outcome.point)) continue;
    if (typeof outcome.price !== "number" || !(outcome.price > 1)) continue;
    const key = normalizePlayerName(player);
    if (!key) continue;
    if (!players.has(key)) players.set(key, { player, lines: new Map() });
    const lines = players.get(key).lines;
    if (!lines.has(outcome.point)) lines.set(outcome.point, {});
    lines.get(outcome.point)[side] = outcome;
  }
  return players;
}

const overChance = (over, under) => (1 / over) / (1 / over + 1 / under);

// A book's main line for a player is its Over/Under pair priced closest to even.
function mainLine(lines) {
  let best = null;
  for (const [point, pair] of lines) {
    if (!pair.over || !pair.under) continue;
    const balance = Math.abs(overChance(pair.over.price, pair.under.price) - 0.5);
    if (!best || balance < best.balance - 1e-9 || (Math.abs(balance - best.balance) <= 1e-9 && point < best.point)) {
      best = { point, over: pair.over, under: pair.under, balance };
    }
  }
  return best;
}

const byStrength = (a, b) => b.score - a.score || b.books - a.books || a.player.localeCompare(b.player);
const round4 = value => Math.round(value * 10_000) / 10_000;

// Each leg is the book's own main-line Over for a player the market leans towards: the hit chance is the average
// no-vig Over chance of every book quoting that same line (at least two), and the book's price must not be far
// below fair. Injured players are left out, a player appears once, and legs are spread across games: every game's
// best leg first, strongest first, then every game's second-best leg, and so on.
export function buildBestParlay({ events = [], oddsByEvent = new Map(), book, markets = [], injured = new Set(), maxLegs = parlayRules.maxLegs }) {
  const games = [];
  const skipped = new Set();
  let bookGames = 0;
  let pricesAt = Infinity;
  for (const event of events) {
    const entry = oddsByEvent.get(event.id);
    const bookmakers = entry?.data?.bookmakers || [];
    const target = bookmakers.find(item => item?.key === book);
    if (!target) continue;
    const fetchedAt = Number(entry.fetchedAt);
    const best = new Map();
    let offered = false;
    for (const market of markets) {
      const targetMarket = (target.markets || []).find(item => item?.key === market);
      if (!targetMarket) continue;
      offered = true;
      if (!quoteIsFresh(targetMarket, target, fetchedAt)) continue;
      const quotes = [];
      for (const bookmaker of bookmakers) {
        const bookMarket = (bookmaker?.markets || []).find(item => item?.key === market);
        if (bookMarket && quoteIsFresh(bookMarket, bookmaker, fetchedAt)) quotes.push(playerLines(bookMarket));
      }
      for (const [key, { player, lines }] of playerLines(targetMarket)) {
        const main = mainLine(lines);
        if (!main) continue;
        if (injured.has(key)) {
          skipped.add(key);
          continue;
        }
        const chances = [];
        for (const bookLines of quotes) {
          const pair = bookLines.get(key)?.lines.get(main.point);
          if (pair?.over && pair?.under) chances.push(overChance(pair.over.price, pair.under.price));
        }
        if (chances.length < parlayRules.minBooks) continue;
        const probability = chances.reduce((sum, value) => sum + value, 0) / chances.length;
        const price = main.over.price;
        const edge = price * probability - 1;
        if (probability < parlayRules.minProbability || price < parlayRules.minPrice || price > parlayRules.maxPrice ||
            edge < parlayRules.minEdge) continue;
        const leg = {
          player,
          market,
          line: main.point,
          price,
          probability: round4(probability),
          books: chances.length,
          edge: round4(edge),
          eventId: event.id,
          home: event.home_team || "",
          away: event.away_team || "",
          start: event.commence_time || "",
          live: Boolean(event.live),
          link: httpsLink(main.over.link),
          marketLink: httpsLink(targetMarket.link),
          eventLink: httpsLink(target.link),
          score: probability + 0.5 * Math.max(-0.08, Math.min(0.08, edge))
        };
        const seen = best.get(key);
        if (!seen || byStrength(leg, seen) < 0) best.set(key, leg);
      }
    }
    if (offered) bookGames += 1;
    if (best.size) {
      games.push([...best.values()].sort(byStrength));
      if (Number.isFinite(fetchedAt)) pricesAt = Math.min(pricesAt, fetchedAt);
    }
  }
  const legs = [];
  const used = new Set();
  for (let round = 0; legs.length < maxLegs; round += 1) {
    const picks = games.map(list => list[round]).filter(Boolean);
    if (!picks.length) break;
    for (const leg of picks.sort(byStrength)) {
      const key = normalizePlayerName(leg.player);
      if (used.has(key) || legs.length >= maxLegs) continue;
      used.add(key);
      const { score, ...shown } = leg;
      legs.push(shown);
    }
  }
  return {
    legs,
    bookGames,
    injuredSkipped: skipped.size,
    pricesAt: Number.isFinite(pricesAt) ? new Date(pricesAt).toISOString() : ""
  };
}
