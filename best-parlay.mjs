// The "Best parlay" at the top of the board: the strongest player-prop Overs and Unders at one sportsbook. While games are
// in progress it is built from them alone, using each player's live box score; otherwise from the next few hours.
// Pure functions only; server.mjs fetches, caches and guards the API quota.

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
  // The next-best legs sent along, so a player the user removes is replaced right away.
  alternateLegs: 8,
  maxGames: 8,
  liveWindow: 5 * hour,
  upcomingWindow: 12 * hour,
  staleQuote: 20 * minute,
  // In-play lines move every minute; a book that stopped updating has suspended or frozen its props.
  liveStaleQuote: 6 * minute,
  minBooks: 2,
  // Only a few books price props in-play, often at different lines, so a live leg may rest on the book alone.
  minLiveBooks: 1,
  minLiveLegs: 2,
  minProbability: 0.5,
  minPrice: 1.25,
  maxPrice: 3.5,
  minEdge: -0.08
};

// Games in progress (latest start first, so games nearly over drop off first), then starts within 12 hours.
// With nothing that close, the next slate: the first upcoming game and everything within 12 hours of it.
// `pending` holds games past their listed start that haven't begun; they count as starting now.
export function selectSlate(events, now = Date.now(), limit = parlayRules.maxGames, pending = new Set()) {
  const games = [];
  for (const event of Array.isArray(events) ? events : []) {
    const start = Date.parse(event?.commence_time);
    if (!event?.id || !Number.isFinite(start)) continue;
    const waiting = start <= now && now - start < parlayRules.liveWindow && pending.has(event.id);
    games.push({ event, start, waiting, order: waiting ? now : start });
  }
  const live = games
    .filter(game => !game.waiting && game.start <= now && now - game.start < parlayRules.liveWindow)
    .sort((a, b) => b.start - a.start);
  const future = games.filter(game => game.waiting || game.start > now).sort((a, b) => a.order - b.order);
  let upcoming = future.filter(game => game.order - now <= parlayRules.upcomingWindow);
  let scope = live.length ? "live" : "soon";
  if (!live.length && !upcoming.length) {
    if (!future.length) return { scope: "none", events: [] };
    upcoming = future.filter(game => game.order - future[0].order <= parlayRules.upcomingWindow);
    scope = "next";
  }
  return {
    scope,
    events: [...live, ...upcoming].slice(0, limit).map(game => ({ ...game.event, live: !game.waiting && game.start <= now }))
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

function nameWords(name) {
  const words = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`.]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  while (words.length > 2 && /^(jr|sr|ii|iii|iv|v)$/.test(words[words.length - 1])) words.pop();
  return words;
}

// "Jaren Jackson Jr." and "Jaren Jackson" match, as do accented and unaccented spellings.
export function normalizePlayerName(name) {
  return nameWords(name).join("");
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

// ---- Live reads: what a player's box score says about his pick while the game is on ----

const liveClockShapes = {
  basketball_nba: { periods: 4, length: 12, prefix: "Q" },
  basketball_wnba: { periods: 4, length: 10, prefix: "Q" },
  icehockey_nhl: { periods: 3, length: 20, prefix: "P" },
  americanfootball_nfl: { periods: 4, length: 15, prefix: "Q" },
  americanfootball_ncaaf: { periods: 4, length: 15, prefix: "Q" }
};

// Usual share of the game a starter / bench player spends on the floor, and the foul-out count.
const hoopsShapes = {
  basketball_nba: { starter: 0.7, bench: 0.4, foulOut: 6 },
  basketball_wnba: { starter: 0.72, bench: 0.4, foulOut: 6 }
};

const liveStatNames = {
  player_points: "PTS", player_rebounds: "REB", player_assists: "AST", player_shots_on_goal: "SOG",
  player_total_saves: "saves", batter_hits: "H", batter_hits_runs_rbis: "H+R+RBI", pitcher_strikeouts: "K",
  player_pass_yds: "pass yds", player_rush_yds: "rush yds", player_reception_yds: "rec yds"
};

const positionNames = { G: ["guard", "guards"], F: ["forward", "forwards"], C: ["center", "centers"] };

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const round1 = value => Math.round(value * 10) / 10;
const round2 = value => Math.round(value * 100) / 100;

function clockMinutes(clock) {
  const text = String(clock ?? "").trim();
  if (text.includes(":")) {
    const [minutes, seconds] = text.split(":").map(Number);
    return (Number.isFinite(minutes) ? minutes : 0) + (Number.isFinite(seconds) ? seconds : 0) / 60;
  }
  const seconds = Number.parseFloat(text);
  return Number.isFinite(seconds) ? seconds / 60 : 0;
}

// Where a game in progress stands: a short clock label, the regulation minutes (innings in baseball) left, the
// share played, and whether it is too late for a new leg (overtime, extra innings or the final minutes).
export function liveClock(sport, game) {
  if (game?.state !== "in") return null;
  const period = Math.max(1, Math.floor(Number(game.period)) || 1);
  const detail = String(game.periodLabel || "").trim();
  if (sport === "baseball_mlb") {
    let left = 10 - period;
    if (/^(mid|bot)/i.test(detail)) left = 9.5 - period;
    else if (/^end/i.test(detail)) left = 9 - period;
    left = Math.max(0, left);
    return { label: detail || `Inning ${period}`, left, unit: "inn", progress: round2(Math.min(1, (9 - left) / 9)), late: left < 1.5 };
  }
  const shape = liveClockShapes[sport];
  if (!shape) return null;
  const total = shape.periods * shape.length;
  const overtime = period > shape.periods;
  const left = overtime ? 0 : (shape.periods - period) * shape.length + Math.min(shape.length, clockMinutes(game.clock));
  const extra = period - shape.periods;
  const name = overtime ? `${extra > 1 ? extra : ""}OT` : `${shape.prefix}${period}`;
  let label = `${name} ${String(game.clock || "").trim()}`.trim();
  if (/half/i.test(detail)) label = "Halftime";
  else if (/^end|intermission/i.test(detail)) label = `End of ${name}`;
  return { label, left: round1(left), unit: "min", progress: round2(Math.min(1, (total - left) / total)), late: overtime || left < total * 0.08 };
}

function statReader(stats) {
  const values = new Map();
  for (const stat of Array.isArray(stats) ? stats : []) {
    const label = String(stat?.label || "").trim().toLowerCase();
    if (label && !values.has(label)) values.set(label, String(stat.value ?? ""));
  }
  const text = label => values.get(label.toLowerCase()) ?? "";
  const number = label => {
    const value = Number.parseFloat(text(label));
    return Number.isFinite(value) ? value : null;
  };
  return { text, number };
}

// The box-score number a market settles on (ESPN labels, as /api/live-game returns them).
function liveStatValue(sport, market, stats) {
  const sum = (...labels) => {
    let total = 0;
    for (const label of labels) {
      const value = stats.number(label);
      if (value === null) return null;
      total += value;
    }
    return total;
  };
  switch (market) {
    case "player_points": return sport === "icehockey_nhl" ? sum("G", "A") : stats.number("PTS");
    case "player_rebounds": return stats.number("REB");
    case "player_assists": return stats.number("AST");
    case "player_shots_on_goal": return stats.number("S");
    case "player_total_saves": return stats.number("SV");
    case "batter_hits": return stats.number("Batting H");
    case "batter_hits_runs_rbis": return sum("Batting H", "Batting R", "Batting RBI");
    case "pitcher_strikeouts": return stats.number("Pitching K");
    case "player_pass_yds": return stats.number("passing YDS");
    case "player_rush_yds": return stats.number("rushing YDS");
    case "player_reception_yds": return stats.number("receiving YDS");
    default: return null;
  }
}

// The player's box-score entry, matched by full name or, when the feeds spell a first name differently
// ("Nic" / "Nicolas"), by surname and first initial if only one player in the game fits.
function findLivePlayer(game, player) {
  const teams = Array.isArray(game?.teams) ? game.teams : [];
  const wanted = nameWords(player);
  if (!wanted.length) return null;
  const entries = teams.flatMap(team => (Array.isArray(team?.players) ? team.players : [])
    .map(athlete => ({ team, athlete, words: nameWords(athlete?.name) })));
  let match = entries.filter(entry => entry.words.join("") === wanted.join(""));
  if (!match.length && wanted.length > 1) {
    const last = wanted[wanted.length - 1];
    match = entries.filter(entry => entry.words.length > 1 && entry.words[entry.words.length - 1] === last &&
      entry.words[0][0] === wanted[0][0]);
  }
  if (match.length !== 1) return null;
  const { team, athlete } = match[0];
  return { team, athlete, opponent: teams.find(other => other !== team) || null };
}

function positionGroup(position) {
  const text = String(position || "").toUpperCase();
  return text.includes("G") ? "G" : text.includes("C") ? "C" : "F";
}

function timeLeftText(read) {
  if (read.unit !== "inn") return `${Math.max(1, Math.round(read.left))} min`;
  const whole = Math.floor(read.left);
  const half = read.left - whole >= 0.25;
  if (!whole) return "½ inning";
  return `${whole}${half ? "½" : ""} inning${whole === 1 && !half ? "" : "s"}`;
}

function paceNote(read, line, pace, so, side = "over") {
  const done = `${read.current} ${read.stat} ${so}`;
  if (side === "under") return {
    tone: pace === "on" || pace === "hot" ? "good" : "neutral",
    text: `${done} — ${pace === "early" ? "early, his pace is still settling" : pace === "open"
      ? `must stay below ${line} with ${timeLeftText(read)} left`
      : `on pace to stay below ${line}, heading for about ${Math.round(read.projected)}`}`
  };
  if (pace === "hot") return { tone: "good", text: `${done} — ahead of pace, heading for about ${Math.round(read.projected)} (line ${line})` };
  if (pace === "on") return { tone: "good", text: `${done} — on pace for about ${Math.round(read.projected)} (line ${line})` };
  if (pace === "early") return { tone: "neutral", text: `${done} — early, his pace is still settling` };
  return { tone: "neutral", text: `${done} — needs ${read.need} more with ${timeLeftText(read)} left` };
}

function scoreNote(read, hoops) {
  const margin = read.teamScore - read.opponentScore;
  const gap = Math.abs(margin);
  const side = margin === 0 ? "tied" : `${read.team || "his team"} ${margin > 0 ? "up" : "down"} ${gap}`;
  if (gap <= 8) return { tone: "good", text: `Close game, ${side}${hoops ? " — starters stay on the floor" : ""}` };
  const text = side.charAt(0).toUpperCase() + side.slice(1);
  if (gap >= 15) return { tone: "warn", text: `${text}${hoops ? " — the rotation could shorten" : ""}` };
  return { tone: "neutral", text };
}

// Basketball: his scoring rate blended with the line's, over the minutes he is likely to get. Players in foul
// trouble, on limited minutes, in a blowout or behind the pace the line needs are left out.
function basketballRead({ sport, market, line, game, clock, found, stats, read, side = "over" }) {
  const shape = hoopsShapes[sport];
  const clockShape = liveClockShapes[sport];
  const total = clockShape.periods * clockShape.length;
  const under = side === "under";
  const { athlete, team } = found;
  const minutes = Math.max(0, stats.number("MIN") ?? 0);
  const fouls = Math.max(0, stats.number("PF") ?? 0);
  const starter = athlete.starter === true;
  const onCourt = athlete.onCourt === true;
  const period = Math.max(1, Math.floor(Number(game.period)) || 1);
  // Coaches sit players with 2 fouls in the 1st quarter, 3 in the 2nd, 4 in the 3rd and 5 in the 4th; at a
  // break the next quarter's limit applies.
  const quarter = clockMinutes(game.clock) <= 0 ? period + 1 : period;
  const foulLimit = Math.min(quarter, clockShape.periods) + 1;
  if (!under && (fouls >= shape.foulOut || fouls >= foulLimit)) return { skip: "fouls" };
  const gap = Math.abs(read.teamScore - read.opponentScore);
  if ((gap >= 20 && clock.left <= total * 0.25) || (gap >= 25 && clock.left <= total * 0.5)) return { skip: "blowout" };
  const elapsed = Math.max(0, total - clock.left);
  const share = clamp((minutes + (starter ? shape.starter : shape.bench) * 12) / (elapsed + 12), 0, 1);
  const early = elapsed < total * 0.125 || (minutes < 3 && elapsed < total * 0.25);
  if (!early && share < 0.35) return { skip: "minutes" };
  // Already playing most of the minutes, he is not losing them to the bench.
  const heavy = !early && minutes >= elapsed * 0.65;
  const group = positionGroup(athlete.position);
  // Bench players at his position who have played: the ones who can take his minutes.
  const bench = (Array.isArray(team.players) ? team.players : []).filter(other => other !== athlete &&
    other?.starter !== true && positionGroup(other?.position) === group && (statReader(other?.stats).number("MIN") ?? 0) > 0).length;
  const oneAway = fouls >= 3 && fouls === foulLimit - 1;
  const rate = (read.current + (line / Math.max(total * 0.25, share * total)) * 10) / (minutes + 10);
  // One foul from trouble, he is likely to sit for part of what is left.
  const projected = read.current + rate * clock.left * share * (oneAway ? 0.85 : 1);
  const ratio = projected / line;
  if (under ? (early ? ratio > 1.2 : ratio >= 1) : (early ? ratio < 0.8 : ratio < 1)) return { skip: under ? "ahead" : "behind" };
  const pace = early ? "early" : under ? ratio <= 0.88 ? "hot" : "on" : ratio >= 1.12 ? "hot" : "on";
  let bonus = early ? 0 : clamp((ratio - 1) * 0.2, -0.04, 0.05);
  bonus += fouls === 0 ? 0.012 : fouls === 1 ? 0.008 : fouls === 2 ? 0.003 : -0.006;
  bonus += clamp((share - 0.55) * 0.06, -0.012, 0.015);
  if (starter) bonus += 0.004;
  bonus += bench === 0 ? 0.008 : bench === 1 ? 0.003 : heavy ? 0 : -0.005 * Math.min(3, bench - 1);
  bonus += gap <= 8 ? 0.004 : gap >= 15 ? -0.008 : 0;
  if (under) bonus *= -1;
  const result = {
    ...read, side, minutes, elapsed: round1(elapsed), fouls, foulLimit, starter, onCourt, bench, position: group,
    projected: round1(projected), pace
  };
  const notes = [paceNote(result, line, pace, `in ${Math.round(minutes)} min`, side)];
  if (market === "player_points") {
    const [made, tried] = stats.text("FG").split("-").map(Number);
    if (Number.isFinite(made) && Number.isFinite(tried) && tried >= 4 && made <= tried) {
      const percent = Math.round((made / tried) * 100);
      notes.push({ tone: percent >= 50 ? "good" : "neutral", text: `Shooting ${made} of ${tried} from the field (${percent}%)` });
    }
  }
  if (fouls === 0) notes.push({ tone: "good", text: "No personal fouls" });
  else if (oneAway) notes.push({ tone: "warn", text: `${fouls} personal fouls — one more puts him in foul trouble` });
  else if (fouls === 1) notes.push({ tone: "good", text: "Only 1 personal foul" });
  else notes.push({ tone: "neutral", text: `${fouls} personal fouls — not in foul trouble` });
  const role = starter ? "Starter" : "Off the bench";
  const where = onCourt ? "on the floor now" : "resting now";
  notes.push(early
    ? { tone: "neutral", text: `${role}, ${where}` }
    : { tone: heavy ? "good" : "neutral", text: `${role}: ${Math.round(minutes)} of ${Math.round(elapsed)} minutes so far, ${where}` });
  const [one, many] = positionNames[group];
  const other = starter ? "" : "other ";
  if (bench === 0) notes.push({ tone: "good", text: `No ${other}bench ${one} has played — little competition for his minutes` });
  else if (bench === 1) notes.push({ tone: "neutral", text: `1 ${other}bench ${one} has played` });
  else if (heavy) notes.push({ tone: "neutral", text: `${bench} ${other}bench ${many} have played, but he is getting most of the minutes` });
  else notes.push({ tone: "warn", text: `${bench} ${other}bench ${many} have played — more competition for minutes` });
  notes.push(scoreNote(read, true));
  return {
    read: { ...result, notes: under ? notes.map((note, index) => index ? { ...note, tone: "neutral" } : note) : notes },
    bonus: round4(bonus)
  };
}

// Other sports: his total so far blended with the line over the share of the game left (for a pitcher, over the
// innings a starter usually has left in a six-inning outing).
function gameRead({ sport, market, line, clock, found, stats, read, side = "over" }) {
  const under = side === "under";
  const gap = Math.abs(read.teamScore - read.opponentScore);
  if (sport.startsWith("americanfootball") && gap >= 24 && clock.progress >= 0.75) return { skip: "blowout" };
  let early = clock.progress < 0.125;
  let rate = (read.current + line * 0.25) / (clock.progress + 0.25);
  let rest = 1 - clock.progress;
  if (market === "pitcher_strikeouts") {
    // ESPN lists a team's pitchers in the order they appeared, so a starter no longer listed last has been pulled.
    const pitchers = (Array.isArray(found.team.players) ? found.team.players : [])
      .filter(other => statReader(other?.stats).text("Pitching IP") !== "");
    if (pitchers[pitchers.length - 1] !== found.athlete) return { skip: "removed" };
    const pitched = stats.number("Pitching IP") ?? 0;
    const innings = Math.floor(pitched) + Math.round((pitched % 1) * 10) / 3;
    rate = (read.current + (line / 6) * 1.5) / (innings + 1.5);
    rest = Math.min(clock.left, Math.max(0.5, 6 - innings));
    early = innings < 1.5;
  }
  // Low lines (one hit, one point) hang on a single play rather than a pace; the price already carries that.
  const counting = line < 2;
  const projected = read.current + rate * rest;
  const ratio = projected / line;
  if (!under && !counting && (early ? ratio < 0.8 : ratio < 1)) return { skip: "behind" };
  if (under && !counting && (early ? ratio > 1.2 : ratio >= 1)) return { skip: "ahead" };
  const pace = counting ? "open" : early ? "early" : under ? ratio <= 0.88 ? "hot" : "on" : ratio >= 1.12 ? "hot" : "on";
  const result = { ...read, side, projected: round1(projected), pace };
  const notes = [paceNote(result, line, pace, "so far", side)];
  const toi = stats.text("TOI");
  if (/^\d+:\d{2}$/.test(toi)) notes.push({ tone: "neutral", text: `${toi} time on ice` });
  if (market === "pitcher_strikeouts") notes.push({ tone: "good", text: `Still on the mound after ${stats.text("Pitching IP") || "0"} innings` });
  notes.push(scoreNote(read, false));
  return {
    read: { ...result, notes: under ? notes.map((note, index) => index ? { ...note, tone: "neutral" } : note) : notes },
    bonus: pace === "hot" || pace === "on" ? round4(clamp((under ? 1 - ratio : ratio - 1) * 0.2, -0.04, 0.05)) : 0
  };
}

// A live read for one pick: his numbers so far, the clock, the score, what stands in his way, and a small
// ranking bonus for players in form. Returns { skip: reason } when the leg should be left out.
export function liveRead({ sport, market, line, player, game, side = "over" }) {
  const clock = liveClock(sport, game);
  if (!clock || !Number.isFinite(line) || line <= 0 || !["over", "under"].includes(side)) return { skip: "unverified" };
  const found = findLivePlayer(game, player);
  if (!found) return { skip: "unverified" };
  const stats = statReader(found.athlete.stats);
  const current = liveStatValue(sport, market, stats);
  if (current === null) return { skip: "unverified" };
  const need = Math.floor(line) + 1 - current;
  if (side === "under" ? current >= line : need <= 0) return { skip: "decided" };
  if (clock.late) return { skip: "late" };
  const read = {
    clock: clock.label,
    left: clock.left,
    unit: clock.unit,
    leftText: "",
    progress: clock.progress,
    team: String(found.team.abbreviation || ""),
    opponent: String(found.opponent?.abbreviation || ""),
    teamScore: Number.parseInt(found.team.score, 10) || 0,
    opponentScore: Number.parseInt(found.opponent?.score, 10) || 0,
    stat: liveStatNames[market] || "",
    side,
    current,
    need
  };
  read.leftText = `${timeLeftText(read)} left`;
  const context = { sport, market, line, game, clock, found, stats, read, side };
  return hoopsShapes[sport] ? basketballRead(context) : gameRead(context);
}

function httpsLink(value) {
  return typeof value === "string" && /^https:\/\//i.test(value) && value.length <= 2000 ? value : "";
}

function quoteIsFresh(market, bookmaker, fetchedAt, limit = parlayRules.staleQuote) {
  const updated = Date.parse(market?.last_update || bookmaker?.last_update || "");
  return !Number.isFinite(updated) || !Number.isFinite(fetchedAt) || fetchedAt - updated <= limit;
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

// Each leg is the book's own main-line Over or Under: the hit chance is the average
// no-vig chance for that side of every book quoting that same line (at least two), and the book's price must not be far
// below fair. Injured players are left out, a player appears once, and legs are spread across games: every game's
// best leg first, strongest first, then every game's second-best leg, and so on. The order carries on past
// `maxLegs` into `alternates`, the next-best legs that stand in for any the user removes.
// With `liveGames` (event id -> /api/live-game data), games in progress are read live: quotes must be minutes old,
// the book's own line can stand alone, each leg carries the player's live read, and players in form rank higher.
export function buildBestParlay({
  events = [], oddsByEvent = new Map(), book, markets = [], injured = new Set(), maxLegs = parlayRules.maxLegs,
  alternateLegs = parlayRules.alternateLegs, sport = "", liveGames = null, includeScore = false
}) {
  const games = [];
  const skipped = new Set();
  const liveChecked = new Set();
  const livePassed = new Set();
  const liveReasons = new Map();
  let bookGames = 0;
  let pricesAt = Infinity;
  for (const event of events) {
    const entry = oddsByEvent.get(event.id);
    const bookmakers = entry?.data?.bookmakers || [];
    const target = bookmakers.find(item => item?.key === book);
    if (!target) continue;
    const fetchedAt = Number(entry.fetchedAt);
    const inPlay = Boolean(liveGames && event.live);
    const liveGame = inPlay ? liveGames.get(event.id) || null : null;
    const staleLimit = inPlay ? parlayRules.liveStaleQuote : parlayRules.staleQuote;
    const minBooks = inPlay ? parlayRules.minLiveBooks : parlayRules.minBooks;
    const best = new Map();
    let offered = false;
    for (const market of markets) {
      const targetMarket = (target.markets || []).find(item => item?.key === market);
      if (!targetMarket) continue;
      offered = true;
      if (!quoteIsFresh(targetMarket, target, fetchedAt, staleLimit)) continue;
      const quotes = [];
      for (const bookmaker of bookmakers) {
        const bookMarket = (bookmaker?.markets || []).find(item => item?.key === market);
        if (bookMarket && quoteIsFresh(bookMarket, bookmaker, fetchedAt, staleLimit)) quotes.push(playerLines(bookMarket));
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
        if (chances.length < minBooks) continue;
        const overProbability = chances.reduce((sum, value) => sum + value, 0) / chances.length;
        for (const side of ["over", "under"]) {
          const outcome = main[side];
          if (!outcome) continue;
          const probability = side === "over" ? overProbability : 1 - overProbability;
          const price = outcome.price;
          const edge = price * probability - 1;
          if (probability < parlayRules.minProbability || price < parlayRules.minPrice || price > parlayRules.maxPrice ||
              edge < parlayRules.minEdge) continue;
          let live = null;
          if (inPlay) {
            liveChecked.add(key);
            live = liveRead({ sport, market, line: main.point, player, game: liveGame, side });
            if (live.skip) {
              if (!liveReasons.has(key)) liveReasons.set(key, live.skip);
              continue;
            }
            livePassed.add(key);
          }
          const leg = {
            player,
            market,
            line: main.point,
            side,
            price,
            probability: round4(probability),
            books: chances.length,
            edge: round4(edge),
            eventId: event.id,
            home: event.home_team || "",
            away: event.away_team || "",
            start: event.commence_time || "",
            live: Boolean(event.live),
            link: httpsLink(outcome.link),
            marketLink: httpsLink(targetMarket.link),
            eventLink: httpsLink(target.link),
            ...(live ? { read: live.read } : {}),
            score: probability + 0.5 * Math.max(-0.08, Math.min(0.08, edge)) + (live ? live.bonus : 0)
          };
          const seen = best.get(key);
          if (!seen || byStrength(leg, seen) < 0) best.set(key, leg);
        }
      }
    }
    if (offered) bookGames += 1;
    if (best.size) {
      games.push([...best.values()].sort(byStrength));
      if (Number.isFinite(fetchedAt)) pricesAt = Math.min(pricesAt, fetchedAt);
    }
  }
  const ranked = [];
  const used = new Set();
  const wanted = maxLegs + Math.max(0, alternateLegs);
  for (let round = 0; ranked.length < wanted; round += 1) {
    const picks = games.map(list => list[round]).filter(Boolean);
    if (!picks.length) break;
    for (const leg of picks.sort(byStrength)) {
      const key = normalizePlayerName(leg.player);
      if (used.has(key) || ranked.length >= wanted) continue;
      used.add(key);
      const { score, ...shown } = leg;
      if (includeScore) shown._rank = score;
      ranked.push(shown);
    }
  }
  const result = {
    legs: ranked.slice(0, maxLegs),
    alternates: ranked.slice(maxLegs),
    bookGames,
    injuredSkipped: skipped.size,
    pricesAt: Number.isFinite(pricesAt) ? new Date(pricesAt).toISOString() : ""
  };
  if (!liveGames) return result;
  // Players the live read left out (counted once, by the first reason), unless another of their lines made it.
  const liveSkipped = {};
  for (const [key, reason] of liveReasons) {
    if (!livePassed.has(key)) liveSkipped[reason] = (liveSkipped[reason] || 0) + 1;
  }
  return { ...result, liveChecked: liveChecked.size, liveSkipped };
}

export function combineBestParlays(results, { maxLegs = parlayRules.maxLegs, alternateLegs = parlayRules.alternateLegs } = {}) {
  const candidates = [];
  for (const result of results || []) {
    const sport = String(result?.sport || "");
    for (const leg of [...(result?.legs || []), ...(result?.alternates || [])]) {
      const rank = Number.isFinite(leg?._rank) ? leg._rank : Number(leg?.probability) || 0;
      candidates.push({ ...leg, sport, _rank: rank });
    }
  }
  candidates.sort((a, b) => b._rank - a._rank || (b.books || 0) - (a.books || 0) || a.player.localeCompare(b.player));
  const selected = [];
  const used = new Set();
  for (const candidate of candidates) {
    const key = `${candidate.sport}|${normalizePlayerName(candidate.player)}`;
    if (!candidate.player || used.has(key)) continue;
    used.add(key);
    selected.push(candidate);
    if (selected.length >= maxLegs + Math.max(0, alternateLegs)) break;
  }
  const clean = selected.map(({ _rank, ...leg }) => leg);
  return { legs: clean.slice(0, maxLegs), alternates: clean.slice(maxLegs) };
}
