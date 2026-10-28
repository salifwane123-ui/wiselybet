import webpush from "web-push";
import { getSubscription, getUserData, listPushUsers, pushDataKey, updateUserData } from "./auth.mjs";

const publicKey = process.env.VAPID_PUBLIC || "";
const privateKey = process.env.VAPID_PRIVATE || "";
export const pushEnabled = Boolean(publicKey && privateKey);
if (pushEnabled) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:salifwane1996@hotmail.com", publicKey, privateKey);
}
export const vapidPublicKey = publicKey;

const allowedHosts = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
function validSubscription(sub) {
  try {
    const url = new URL(sub?.endpoint);
    return url.protocol === "https:" && allowedHosts.some(rule => rule.test(url.hostname)) &&
      typeof sub.keys?.p256dh === "string" && typeof sub.keys?.auth === "string" &&
      sub.endpoint.length < 600;
  } catch { return false; }
}

async function readList(userKey) {
  try {
    const list = JSON.parse((await getUserData(userKey))[pushDataKey] || "[]");
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
function writeList(userKey, list) {
  return updateUserData(userKey, { data: { [pushDataKey]: list.length ? JSON.stringify(list) : null } }, true);
}

export async function addSubscription(userKey, body) {
  if (!pushEnabled) throw Object.assign(new Error("Phone alerts are not set up on this server."), { status: 503 });
  const sub = body?.subscription;
  if (!validSubscription(sub)) throw Object.assign(new Error("Invalid subscription."), { status: 400 });
  const tz = typeof body.tz === "string" && /^[\w/+-]{1,60}$/.test(body.tz) ? body.tz : "UTC";
  const list = (await readList(userKey)).filter(item => item.endpoint !== sub.endpoint);
  list.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, tz });
  await writeList(userKey, list.slice(-5));
}

export async function removeSubscription(userKey, endpoint) {
  await writeList(userKey, (await readList(userKey)).filter(item => item.endpoint !== endpoint));
}

async function deliver(userKey, list, payload) {
  const alive = [];
  let sent = 0;
  for (const sub of list) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 600, urgency: "high" });
      alive.push(sub);
      sent++;
    } catch (caught) {
      if (caught.statusCode !== 404 && caught.statusCode !== 410) alive.push(sub);
    }
  }
  if (alive.length !== list.length) await writeList(userKey, alive);
  return sent;
}

export async function sendTest(userKey) {
  const list = await readList(userKey);
  if (!list.length) throw Object.assign(new Error("This phone isn't subscribed yet."), { status: 400 });
  const sent = await deliver(userKey, list, { title: "WiselyBet", body: "Phone alerts are on. You'll get live updates here.", tag: "wb-test" });
  return { sent };
}

// ---- Background checker -------------------------------------------------

const pitcherStats = new Set(["PK", "PHA", "PER", "POUT"]);
const normalize = name => String(name || "").toLowerCase().replace(/[^a-z]/g, "");
const isFootball = sport => sport === "americanfootball_nfl" || sport === "americanfootball_ncaaf";
const statNames = {
  PTS: "points", REB: "rebounds", AST: "assists", G: "goals", A: "assists", SOG: "shots on goal", BLK: "blocks", SAV: "saves",
  H: "hits", HR: "home runs", RBI: "RBIs", R: "runs", BB: "walks", HRR: "hits + runs + RBIs", PK: "strikeouts", PHA: "hits allowed",
  PER: "earned runs", POUT: "outs", PYD: "passing yards", PTD: "passing TDs", PCMP: "completions", PATT: "attempts", PINT: "interceptions",
  RYD: "rushing yards", RTD: "rushing TDs", RATT: "carries", REC: "receptions", RECYD: "receiving yards", RECTD: "receiving TDs"
};

function findAthlete(game, name) {
  const wanted = normalize(name);
  for (const team of game.teams || []) {
    const athlete = (team.players || []).find(candidate => normalize(candidate.name) === wanted);
    if (athlete) return athlete;
  }
  return null;
}

// Mirrors the stat derivation of the in-page tracker.
function deriveStats(sport, stat, athlete) {
  const stats = {};
  for (const item of athlete?.stats || []) stats[item.label] = item.value;
  const number = key => Number.parseInt(stats[key], 10) || 0;
  if (sport === "baseball_mlb") {
    const role = pitcherStats.has(stat) ? "Pitching " : "Batting ";
    for (const key of Object.keys(stats)) if (key.startsWith(role)) stats[key.slice(role.length)] = stats[key];
    const ip = Number.parseFloat(stats.IP) || 0;
    stats.HRR = String(number("H") + number("R") + number("RBI"));
    stats.PK = stats.K; stats.PHA = stats.H; stats.PER = stats.ER;
    stats.POUT = String(Math.floor(ip) * 3 + Math.round((ip % 1) * 10));
  } else if (isFootball(sport)) {
    stats.PYD = stats["passing YDS"]; stats.PTD = stats["passing TD"]; stats.PINT = stats["passing INT"];
    stats.PCMP = String(number("passing C/ATT"));
    stats.PATT = String(Number.parseInt(String(stats["passing C/ATT"] || "").split("/")[1], 10) || 0);
    stats.RYD = stats["rushing YDS"]; stats.RTD = stats["rushing TD"]; stats.RATT = stats["rushing CAR"];
    stats.REC = stats["receiving REC"]; stats.RECYD = stats["receiving YDS"]; stats.RECTD = stats["receiving TD"];
  } else if (sport === "icehockey_nhl") {
    stats.PTS = String(number("G") + number("A"));
    stats.SOG = stats.S; stats.SAV = stats.SV; stats.BLK = stats.BS;
  }
  return stats;
}

const states = new Map();
let running = false;
const intervalMs = 30_000;

function localDate(value, tz) {
  try { return new Date(value).toLocaleDateString("en-CA", { timeZone: tz }); }
  catch { return new Date(value).toISOString().slice(0, 10); }
}

function inWindow(entry) {
  const start = Date.parse(entry.date);
  if (!Number.isFinite(start)) return false;
  const now = Date.now();
  return now >= start - 20 * 60_000 && now <= start + 7 * 3_600_000;
}

function injuryText(name, injury) {
  return `${name} injury report: ${injury.status}${injury.detail ? ` — ${injury.detail}` : ""}`;
}

async function checkUser({ userKey, data }, fetchGame) {
  let subs, trackers, followed, settings;
  try {
    subs = JSON.parse(data[pushDataKey] || "[]");
    trackers = JSON.parse(data["courtside.trackers.v1"] || "[]");
    followed = JSON.parse(data["courtside.followedPlayers.v1"] || "[]");
    settings = JSON.parse(data["courtside.settings.v1"] || "{}");
  } catch { return; }
  if (!Array.isArray(subs) || !subs.length) return;
  const sub = await getSubscription(userKey);
  if (sub && sub.status === "expired") return;
  const alerts = settings?.alerts || {};
  const allowed = kind => alerts[kind] !== false;
  const tz = subs[0].tz || "UTC";
  const live = list => (Array.isArray(list) ? list : []).filter(item => item && item.name && item.sport && item.home && item.away && inWindow(item));
  const activeTrackers = live(trackers).filter(item => !item.demo && Number(item.target) > 0 && item.stat);
  const activeFollowed = live(followed);
  if (!activeTrackers.length && !activeFollowed.length) return;

  const userState = states.get(userKey) || new Map();
  states.set(userKey, userState);
  const messages = [];
  const games = new Map();
  const gameFor = async entry => {
    const date = localDate(entry.date, tz);
    const key = JSON.stringify([entry.sport, entry.home, entry.away, date]);
    if (!games.has(key)) games.set(key, fetchGame(entry.sport, date, entry.home, entry.away).catch(() => null));
    return games.get(key);
  };

  for (const tracker of activeTrackers) {
    const id = `t:${tracker.key}`;
    const previous = userState.get(id);
    if (previous?.done) continue;
    const game = await gameFor(tracker);
    if (!game?.teams) continue;
    const athlete = findAthlete(game, tracker.name);
    const stats = deriveStats(tracker.sport, tracker.stat, athlete);
    const current = Number.parseInt(stats[tracker.stat], 10) || 0;
    const target = Number(tracker.target);
    const label = statNames[tracker.stat] || tracker.stat;
    const hockeyLike = tracker.sport !== "basketball_nba" && tracker.sport !== "basketball_wnba";
    const fouls = hockeyLike ? 0 : Number.parseInt(stats.PF, 10) || 0;
    const onCourt = athlete ? (hockeyLike || Boolean(athlete.onCourt)) : true;
    const injuryEntry = (game.injuries || []).find(item => normalize(item.name) === normalize(tracker.name));
    const injury = injuryEntry ? { status: injuryEntry.status, detail: injuryEntry.detail } : null;
    const injuryKey = injury ? `${injury.status}|${injury.detail}` : "";
    const next = { current, fouls, onCourt, injuryKey, hit: previous?.hit || false, close: previous?.close || false, done: false };
    if (previous) {
      if (current >= target && !next.hit) {
        if (allowed("score")) messages.push({ title: "🎉 Target hit", body: `${tracker.name} reached ${target} ${label}!`, tag: `hit-${tracker.key}` });
      } else if (current < target && !next.close && game.state === "in" && current > previous.current && target - current <= Math.max(1, Math.round(target * 0.1))) {
        next.close = true;
        if (allowed("score")) messages.push({ title: "🔥 Close to target", body: `${tracker.name} has ${current}/${target} ${label}.`, tag: `close-${tracker.key}` });
      }
      if (previous.current < target) {
        if (game.state === "in" && athlete && onCourt !== previous.onCourt && allowed("court")) {
          messages.push({ title: "Court update", body: onCourt ? `${tracker.name} is on the court.` : `${tracker.name} went to the bench.`, tag: `court-${tracker.key}` });
        }
        if (fouls > previous.fouls && allowed("foul")) messages.push({ title: "Foul", body: `${tracker.name} committed a foul (${fouls} PF).`, tag: `foul-${tracker.key}` });
        if (injury && injuryKey !== previous.injuryKey && allowed("injury")) messages.push({ title: "Injury report", body: injuryText(tracker.name, injury), tag: `inj-${tracker.key}` });
      }
    }
    next.hit = next.hit || current >= target;
    if (game.state === "post" && previous) {
      next.done = true;
      if (allowed("score")) {
        const hit = current >= target;
        messages.push({
          title: hit ? "✅ Final — pick hit" : "❌ Final — pick missed",
          body: `${tracker.name} finished with ${current} ${label} (target ${target}).`,
          tag: `final-${tracker.key}`
        });
      }
    }
    userState.set(id, next);
  }

  const trackedNames = new Set(activeTrackers.map(item => normalize(item.name)));
  for (const player of activeFollowed) {
    if (trackedNames.has(normalize(player.name))) continue;
    const id = `f:${player.key}`;
    const previous = userState.get(id);
    const game = await gameFor(player);
    if (!game?.teams) continue;
    const athlete = findAthlete(game, player.name);
    const injuryEntry = (game.injuries || []).find(item => normalize(item.name) === normalize(player.name));
    const injury = injuryEntry ? { status: injuryEntry.status, detail: injuryEntry.detail } : null;
    const injuryKey = injury ? `${injury.status}|${injury.detail}` : "";
    const seen = new Set((game.plays || []).map(play => play.id));
    const next = { onCourt: Boolean(athlete?.onCourt), found: Boolean(athlete), injuryKey, seen };
    if (!previous) {
      if (injury && allowed("injury")) messages.push({ title: "Injury report", body: injuryText(player.name, injury), tag: `inj-${player.key}` });
    } else {
      if (game.state === "in" && player.sport.startsWith("basketball") && next.found && next.onCourt !== previous.onCourt && allowed("court")) {
        messages.push({ title: "Court update", body: next.onCourt ? `${player.name} is on the court.` : `${player.name} went to the bench.`, tag: `court-${player.key}` });
      }
      if (injury && injuryKey !== previous.injuryKey && allowed("injury")) {
        messages.push({ title: "Injury report", body: injuryText(player.name, injury), tag: `inj-${player.key}` });
      }
      const wanted = normalize(player.name);
      for (const play of [...(game.plays || [])].filter(item => !previous.seen.has(item.id) && item.text).reverse()) {
        if (!normalize(play.text).includes(wanted)) continue;
        const detail = `${play.type} ${play.text}`;
        const kind = /injur/i.test(detail) ? "injury" : /foul|technical|flagrant|ejected/i.test(detail) ? "foul" : "";
        if (kind && allowed(kind)) messages.push({ title: kind === "injury" ? "Injury" : "Foul", body: play.text, tag: `play-${play.id}` });
      }
    }
    userState.set(id, next);
  }

  for (const message of messages.slice(0, 6)) await deliver(userKey, subs, { ...message, url: "/" });
}

async function runChecks(fetchGame) {
  if (running) return;
  running = true;
  try {
    for (const user of await listPushUsers()) {
      try { await checkUser(user, fetchGame); } catch (caught) { console.error("Push check failed:", caught.message); }
    }
  } catch (caught) {
    console.error("Push check failed:", caught.message);
  } finally {
    running = false;
  }
}

export function startPushChecker(fetchGame) {
  if (!pushEnabled) return;
  setInterval(() => void runChecks(fetchGame), intervalMs).unref();
}
