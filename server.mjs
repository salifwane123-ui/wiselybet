import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { displayName, firebaseEnabled, firebaseSignIn, firebaseWebConfig, getSessionUser, getSubscription, getUserData, logIn, logOut, pushDataKey, queueEmail, reportActive, signUp, subscribe, updateUserData } from "./auth.mjs";
import { randomBytes } from "node:crypto";
import { addSubscription, removeSubscription, sendTest, startPushChecker, vapidPublicKey, pushEnabled } from "./push.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const apiKey = process.env.THE_ODDS_API_KEY;
const regions = process.env.ODDS_REGIONS || "us";
const espnScoreboardSports = {
  basketball_nba: "basketball/nba",
  icehockey_nhl: "hockey/nhl",
  americanfootball_nfl: "football/nfl",
  americanfootball_ncaaf: "football/college-football",
  baseball_mlb: "baseball/mlb",
  basketball_wnba: "basketball/wnba"
};
const liveGameSports = new Set([
  "basketball_nba",
  "basketball_wnba",
  "icehockey_nhl",
  "baseball_mlb",
  "americanfootball_nfl",
  "americanfootball_ncaaf"
]);
const playerPropMarkets = {
  basketball_nba: new Set([
    "player_points",
    "player_rebounds",
    "player_assists",
    "player_threes",
    "player_blocks",
    "player_steals",
    "player_turnovers",
    "player_points_rebounds_assists"
  ]),
  icehockey_nhl: new Set([
    "player_points",
    "player_goals",
    "player_assists",
    "player_shots_on_goal",
    "player_blocked_shots",
    "player_power_play_points",
    "player_total_saves"
  ]),
  baseball_mlb: new Set([
    "batter_hits",
    "batter_total_bases",
    "batter_home_runs",
    "batter_rbis",
    "batter_runs_scored",
    "batter_hits_runs_rbis",
    "batter_walks",
    "batter_stolen_bases",
    "pitcher_strikeouts",
    "pitcher_hits_allowed",
    "pitcher_earned_runs",
    "pitcher_outs"
  ]),
  americanfootball_nfl: new Set([
    "player_pass_yds",
    "player_pass_tds",
    "player_pass_completions",
    "player_pass_attempts",
    "player_pass_interceptions",
    "player_rush_yds",
    "player_rush_tds",
    "player_rush_attempts",
    "player_receptions",
    "player_reception_yds",
    "player_reception_tds"
  ])
};
playerPropMarkets.basketball_wnba = playerPropMarkets.basketball_nba;
playerPropMarkets.americanfootball_ncaaf = playerPropMarkets.americanfootball_nfl;

async function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

async function fetchOddsApi(endpoint, parameters = {}) {
  const ttl = endpoint === "sports/" ? cacheTtlMs.sports : cacheTtlMs.odds;
  return cached(`odds:${endpoint}:${JSON.stringify(parameters)}`, ttl, () => requestOddsApi(endpoint, parameters));
}

async function requestOddsApi(endpoint, parameters) {
  if (!apiKey) {
    const error = new Error("Set THE_ODDS_API_KEY in the server environment.");
    error.status = 503;
    throw error;
  }

  const url = new URL(`https://api.the-odds-api.com/v4/${endpoint}`);
  url.searchParams.set("apiKey", apiKey);
  for (const [name, value] of Object.entries(parameters)) {
    url.searchParams.set(name, value);
  }

  const result = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const body = await result.json().catch(() => null);
  if (!result.ok) {
    const error = new Error(
      body?.message || `Odds provider returned HTTP ${result.status}.`
    );
    error.status = result.status >= 400 && result.status < 600
      ? result.status
      : 502;
    throw error;
  }
  return body;
}

async function fetchEspnJson(url) {
  return cached(`espn:${url}`, cacheTtlMs.espn, () => requestEspnJson(url));
}

async function requestEspnJson(url) {
  const result = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15000)
  });
  const body = await result.json().catch(() => null);
  if (!result.ok || !body) {
    const error = new Error(`ESPN game data request failed (HTTP ${result.status}).`);
    error.status = result.status >= 400 && result.status < 600
      ? result.status
      : 502;
    throw error;
  }
  return body;
}

function normalizeTeamName(name) {
  return String(name || "").toLowerCase().replace(/[^a-z]/g, "");
}

function teamsMatch(eventTeam, requestedTeam) {
  const eventName = normalizeTeamName(eventTeam);
  const requestedName = normalizeTeamName(requestedTeam);
  if (eventName === requestedName) return true;
  const eventNickname = normalizeTeamName(String(eventTeam || "").trim().split(/\s+/).pop());
  const requestedNickname = normalizeTeamName(String(requestedTeam || "").trim().split(/\s+/).pop());
  return Boolean(eventName && requestedName && eventNickname === requestedNickname);
}

const apiCache = new Map();
const cacheTtlMs = { sports: 10 * 60_000, odds: 60_000, props: 60_000, espn: 10_000 };

// Serves repeated identical upstream requests from memory to save API quota.
async function cached(key, ttl, load) {
  const hit = apiCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await load();
  apiCache.set(key, { value, expires: Date.now() + ttl });
  if (apiCache.size > 300) {
    for (const [name, entry] of apiCache) if (entry.expires < Date.now()) apiCache.delete(name);
  }
  return value;
}

const rateWindowMs = 60_000;
const rateLimit = 240;
const rateBuckets = new Map();
const internalToken = randomBytes(16).toString("hex");

function isRateLimited(address) {
  const now = Date.now();
  const bucket = rateBuckets.get(address);
  if (!bucket || bucket.reset < now) {
    rateBuckets.set(address, { count: 1, reset: now + rateWindowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > rateLimit;
}

setInterval(() => {
  const now = Date.now();
  for (const [address, bucket] of rateBuckets) if (bucket.reset < now) rateBuckets.delete(address);
}, rateWindowMs).unref();

let previewCache = null;
let previewPropsCache = null;
const guestPropPlayers = 5;
const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "media-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'self'",
    "base-uri 'none'",
    "form-action 'self'"
  ].join("; ")
};

// Only the login page may load the Firebase sign-in scripts and talk to Google's auth services.
function loginPolicy() {
  const config = firebaseWebConfig();
  const frame = ["https://accounts.google.com", config?.authDomain ? `https://${config.authDomain}` : ""].filter(Boolean).join(" ");
  return securityHeaders["Content-Security-Policy"]
    .replace("script-src 'self' 'unsafe-inline'", "script-src 'self' 'unsafe-inline' https://www.gstatic.com https://apis.google.com")
    .replace("connect-src 'self'", "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com")
    .replace("media-src 'self'", `media-src 'self'; frame-src ${frame}`);
}

const appIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="#12150f"/><circle cx="64" cy="64" r="40" fill="none" stroke="#c9ef5b" stroke-width="10"/><path d="M82 48a26 26 0 1 0 0 32" fill="none" stroke="#c9ef5b" stroke-width="10" stroke-linecap="round"/></svg>`;
const webManifest = JSON.stringify({
  name: "WiselyBet Market Board",
  short_name: "WiselyBet",
  start_url: "/",
  display: "standalone",
  background_color: "#12150f",
  theme_color: "#12150f",
  icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }]
});
const serviceWorker = `const shell = "courtside-shell-v4";
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (error) { data = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || "WiselyBet", {
    body: data.body || "", tag: data.tag, icon: "/icon-192.png", badge: "/icon-192.png", data: { url: data.url || "/" }, renotify: Boolean(data.tag)
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const client of list) if ("focus" in client) return client.focus();
    return self.clients.openWindow(target);
  }));
});
self.addEventListener("install", event => { self.skipWaiting(); });
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== shell).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && !response.redirected) { const copy = response.clone(); caches.open(shell).then(cache => cache.put(event.request, copy)); }
    return response;
  }).catch(() => caches.match(event.request).then(match => match || new Response("Offline", { status: 503 }))));
});`;

function sendStatic(response, type, body) {
  response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
  response.end(body);
}

// Parlay recap email. The recipient comes only from the server environment, never from the request.
const mailConfig = {
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT || 465),
  user: process.env.SMTP_USER || "",
  pass: process.env.SMTP_PASS || "",
  to: process.env.MAIL_TO || "salifwane1996@hotmail.com",
  dryRun: process.env.MAIL_DRY_RUN === "1"
};
const emailLimit = { count: 0, reset: 0, max: 20 };
let mailTransport = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function cleanText(value, max) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, max);
}

// Accepts only a small structured recap and builds both the text and HTML bodies itself.
function buildRecapEmail(payload) {
  const subject = cleanText(payload?.subject, 150).replace(/[\r\n]+/g, " ") || "WiselyBet parlay recap";
  const won = payload?.tone === "hype";
  const intro = cleanText(payload?.intro, 600);
  const sections = (Array.isArray(payload?.sections) ? payload.sections : []).slice(0, 20).map(section => ({
    heading: cleanText(section?.heading, 160),
    items: (Array.isArray(section?.items) ? section.items : []).slice(0, 20).map(item => cleanText(item, 500))
  }));
  const text = [
    subject,
    "",
    intro,
    ...sections.flatMap(section => ["", section.heading, ...section.items.map(item => `- ${item}`)]),
    "",
    "Informational only. Not betting advice. Gambling involves risk — only wager what you can afford to lose. Need help? Call 1-800-GAMBLER."
  ].join("\n");
  const accent = won ? "#2e9e5b" : "#d64545";
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1b2418">
<div style="background:${accent};color:#fff;padding:16px 20px;border-radius:12px 12px 0 0"><div style="font-size:12px;letter-spacing:.08em">WISELYBET</div><h1 style="margin:4px 0 0;font-size:20px">${escapeHtml(subject)}</h1></div>
<div style="border:1px solid #dfe5d6;border-top:0;padding:16px 20px;border-radius:0 0 12px 12px">
<p style="margin:0 0 12px;line-height:1.5">${escapeHtml(intro)}</p>
${sections.map(section => `<h2 style="font-size:14px;margin:16px 0 6px;color:${accent}">${escapeHtml(section.heading)}</h2><ul style="margin:0;padding-left:18px;line-height:1.5">${section.items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`).join("")}
<p style="margin:18px 0 0;padding-top:12px;border-top:1px solid #dfe5d6;font-size:11px;color:#5b6658">Informational only. Not betting advice. Gambling involves risk — only wager what you can afford to lose. Need help? Call 1-800-GAMBLER or visit ncpgambling.org.</p>
</div></div>`;
  return { subject, text, html };
}

async function readJsonBody(request, limit = 20_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error("Request too large.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON.");
    error.status = 400;
    throw error;
  }
}

async function handleSendEmail(request, response) {
  const origin = request.headers.origin;
  if (origin && origin !== `http://${request.headers.host}` && origin !== `https://${request.headers.host}`) {
    return sendJson(response, 403, { error: "Cross-origin requests are not allowed." });
  }
  const smtpReady = Boolean(mailConfig.user && mailConfig.pass);
  if (!mailConfig.dryRun && !smtpReady && !firebaseEnabled) {
    return sendJson(response, 503, { error: "Email is not set up on the server (set SMTP_USER and SMTP_PASS, or enable Firebase)." });
  }
  const now = Date.now();
  if (now > emailLimit.reset) Object.assign(emailLimit, { count: 0, reset: now + 3_600_000 });
  if (emailLimit.count >= emailLimit.max) return sendJson(response, 429, { error: "Email limit reached. Try again later." });
  const message = buildRecapEmail(await readJsonBody(request));
  emailLimit.count += 1;
  if (mailConfig.dryRun) return sendJson(response, 200, { ok: true, dryRun: true, to: mailConfig.to, ...message });
  if (!smtpReady) {
    try {
      await queueEmail(mailConfig.to, message);
    } catch (caught) {
      console.error("Email queue failed:", caught.message);
      return sendJson(response, 502, { error: "The email could not be queued." });
    }
    return sendJson(response, 200, { ok: true, queued: true });
  }
  if (!mailTransport) {
    const { default: nodemailer } = await import("nodemailer");
    mailTransport = nodemailer.createTransport({
      host: mailConfig.host,
      port: mailConfig.port,
      secure: mailConfig.port === 465,
      auth: { user: mailConfig.user, pass: mailConfig.pass }
    });
  }
  try {
    await mailTransport.sendMail({ from: `"WiselyBet" <${mailConfig.user}>`, to: mailConfig.to, ...message });
  } catch (caught) {
    console.error("Email failed:", caught.message);
    return sendJson(response, 502, { error: "The email could not be sent. Check the SMTP settings on the server." });
  }
  return sendJson(response, 200, { ok: true });
}

const server = createServer(async (request, response) => {
  for (const [name, value] of Object.entries(securityHeaders)) response.setHeader(name, value);

  const requestPath = (request.url || "").split("?")[0];
  if (request.method !== "GET") {
    const postRoutes = ["/api/auth/signup", "/api/auth/login", "/api/auth/logout", "/api/auth/firebase", "/api/send-parlay-email", "/api/subscription/subscribe", "/api/push/subscribe", "/api/push/unsubscribe", "/api/push/test"];
    const allowed = (request.method === "POST" && postRoutes.includes(requestPath)) ||
      (request.method === "PUT" && requestPath === "/api/user-data");
    if (!allowed) {
      response.writeHead(405, { Allow: "GET, POST, PUT" });
      response.end("Method not allowed");
      return;
    }
    try {
      const origin = request.headers.origin;
      if (origin && origin !== `http://${request.headers.host}` && origin !== `https://${request.headers.host}`) {
        return await sendJson(response, 403, { error: "Cross-origin requests are not allowed." });
      }
      const address = request.socket.remoteAddress || "local";
      if (requestPath === "/api/auth/signup") return await sendJson(response, 200, await signUp(await readJsonBody(request, 2000), response, address));
      if (requestPath === "/api/auth/login") return await sendJson(response, 200, await logIn(await readJsonBody(request, 2000), response, address));
      if (requestPath === "/api/auth/firebase") return await sendJson(response, 200, await firebaseSignIn(await readJsonBody(request, 6000), response, address));
      if (requestPath === "/api/auth/logout") {
        await logOut(request, response);
        return await sendJson(response, 200, { ok: true });
      }
      const userKey = await getSessionUser(request);
      if (!userKey) return await sendJson(response, 401, { error: "Please sign in." });
      if (requestPath === "/api/user-data") {
        await updateUserData(userKey, await readJsonBody(request, 1_100_000));
        return await sendJson(response, 200, { ok: true });
      }
      if (requestPath === "/api/subscription/subscribe") {
        const body = await readJsonBody(request, 500);
        return await sendJson(response, 200, await subscribe(userKey, String(body?.plan || "")));
      }
      if (requestPath === "/api/push/subscribe") {
        await addSubscription(userKey, await readJsonBody(request, 4000));
        return await sendJson(response, 200, { ok: true });
      }
      if (requestPath === "/api/push/unsubscribe") {
        await removeSubscription(userKey, String((await readJsonBody(request, 2000))?.endpoint || ""));
        return await sendJson(response, 200, { ok: true });
      }
      if (requestPath === "/api/push/test") return await sendJson(response, 200, await sendTest(userKey));
      return await handleSendEmail(request, response);
    } catch (caught) {
      return sendJson(response, caught.status || 500, { error: caught.message || "Request failed." });
    }
  }

  const url = new URL(request.url || "/", "http://localhost");
  if (url.pathname.startsWith("/api/") && request.headers["x-wb-internal"] !== internalToken && isRateLimited(request.socket.remoteAddress || "local")) {
    response.writeHead(429, { "Retry-After": "30", "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Too many requests. Please slow down and try again shortly." }));
    return;
  }

  try {
    if (url.pathname === "/manifest.webmanifest") return sendStatic(response, "application/manifest+json", webManifest);
    if (url.pathname === "/icon.svg") return sendStatic(response, "image/svg+xml", appIcon);
    if (/^\/(apple-touch-icon|icon-192|icon-512)\.png$/.test(url.pathname)) {
      return sendStatic(response, "image/png", await readFile(join(directory, "icons", url.pathname.slice(1))));
    }
    if (url.pathname === "/sw.js") return sendStatic(response, "text/javascript; charset=utf-8", serviceWorker);
    if (url.pathname === "/healthz") return sendStatic(response, "text/plain", "ok");
    if (url.pathname === "/api/auth/config") return await sendJson(response, 200, { firebase: firebaseWebConfig() });

    const userKey = await getSessionUser(request);
    if (userKey) reportActive(userKey);
    // Premium = signed in with an active trial or subscription; an expired trial falls back to the guest preview.
    const sub = userKey ? await getSubscription(userKey) : null;
    const premium = Boolean(sub && sub.status !== "expired");
    if (url.pathname === "/subscribe" && userKey) {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(await readFile(join(directory, "subscribe.html")));
      return;
    }
    if (url.pathname === "/api/subscription" && userKey) return await sendJson(response, 200, sub);
    if (url.pathname === "/login") {
      if (userKey) {
        response.writeHead(302, { Location: "/" });
        response.end();
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...(firebaseEnabled ? { "Content-Security-Policy": loginPolicy() } : {}) });
      response.end(await readFile(join(directory, "login.html")));
      return;
    }
    // Guests may open the main page and the live scores; the odds and everything else need an account.
    const guestAllowed = ["/", "/index.html", "/api/live-scores", "/api/matchup-insight", "/api/live-game", "/api/preview", "/api/preview-props", "/api/sports", "/api/odds", "/api/player-props", "/api/news", "/game"].includes(url.pathname) ||
      /^\/sounds\/[\w-]+\.(mp3|wav|ogg|m4a)$/i.test(url.pathname);
    if (!userKey && !guestAllowed) {
      if (url.pathname.startsWith("/api/")) return await sendJson(response, 401, { error: "Sign in to see the odds." });
      response.writeHead(302, { Location: "/login", "Cache-Control": "no-store" });
      response.end();
      return;
    }
    if (url.pathname === "/api/auth/me") return await sendJson(response, 200, { username: displayName(userKey) });
    if (url.pathname === "/api/push/key") return await sendJson(response, 200, { key: pushEnabled ? vapidPublicKey : "" });
    if (url.pathname === "/api/user-data") {
      let data = {};
      try {
        data = { ...(await getUserData(userKey)) };
        delete data[pushDataKey];
      } catch (caught) {
        console.error("Could not load account data:", caught.message);
        return await sendJson(response, 503, { error: "Account data is temporarily unavailable. Please try again." });
      }
      return await sendJson(response, 200, { username: displayName(userKey), data, subscription: sub });
    }

    if (url.pathname === "/api/preview") {
      // Guest teaser: a few real games with live prices, cached briefly to protect the API quota.
      if (!previewCache || Date.now() - previewCache.at > 120_000) {
        let events = [];
        for (const sport of ["basketball_nba", "icehockey_nhl"]) {
          const odds = await fetchOddsApi(`sports/${sport}/odds/`, { regions, markets: "h2h", oddsFormat: "decimal" });
          events = (Array.isArray(odds) ? odds : [])
            .filter(event => Date.parse(event.commence_time) > Date.now())
            .sort((a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time))
            .slice(0, 6);
          if (events.length) break;
        }
        previewCache = { at: Date.now(), events };
      }
      return await sendJson(response, 200, previewCache.events);
    }

    if (url.pathname === "/api/preview-props") {
      // Guest teaser: the top few player points lines of the first preview game, cached briefly.
      if (!previewPropsCache || Date.now() - previewPropsCache.at > 300_000) {
        let result = { game: "", players: [] };
        try {
          for (const sport of ["basketball_nba", "icehockey_nhl"]) {
            const events = (await fetchOddsApi(`sports/${sport}/odds/`, { regions, markets: "h2h", oddsFormat: "decimal" }))
              .filter(event => Date.parse(event.commence_time) > Date.now())
              .sort((a, b) => Date.parse(a.commence_time) - Date.parse(b.commence_time))
              .slice(0, 3);
            for (const event of events) {
              const odds = await fetchOddsApi(`sports/${sport}/events/${event.id}/odds/`, {
                regions, markets: "player_points", oddsFormat: "decimal"
              });
              const best = new Map();
              for (const book of odds.bookmakers || []) {
                for (const outcome of book.markets?.[0]?.outcomes || []) {
                  if (outcome.name !== "Over" || !outcome.description) continue;
                  const current = best.get(outcome.description);
                  if (!current || outcome.price > current.price) {
                    best.set(outcome.description, { player: outcome.description, line: outcome.point, price: outcome.price, book: book.title });
                  }
                }
              }
              if (best.size) {
                result = { game: `${event.away_team} at ${event.home_team}`, market: "Points", players: [...best.values()].slice(0, 8) };
                break;
              }
            }
            if (result.players.length) break;
          }
        } catch { /* an empty preview just hides the section */ }
        previewPropsCache = { at: Date.now(), result };
      }
      return await sendJson(response, 200, previewPropsCache.result);
    }

    if (url.pathname === "/api/sports") {
      const sports = await fetchOddsApi("sports/");
      await sendJson(response, 200, sports);
      return;
    }

    if (url.pathname === "/api/odds") {
      const sport = url.searchParams.get("sport") || "";
      if (!/^[a-z0-9_]+$/i.test(sport)) {
        await sendJson(response, 400, { error: "Provide a valid sport key." });
        return;
      }

      const odds = await fetchOddsApi(
        `sports/${encodeURIComponent(sport)}/odds/`,
        { regions, markets: "h2h", oddsFormat: "decimal" }
      );
      await sendJson(response, 200, odds);
      return;
    }

    if (url.pathname === "/api/player-props") {
      const sport = url.searchParams.get("sport") || "";
      const eventId = url.searchParams.get("eventId") || "";
      const market = url.searchParams.get("market") || "";
      if (!Object.hasOwn(playerPropMarkets, sport)) {
        await sendJson(response, 400, { error: "Player props are not supported for this sport." });
        return;
      }
      if (!/^[a-f0-9-]{20,}$/i.test(eventId)) {
        await sendJson(response, 400, { error: "Provide a valid event ID." });
        return;
      }
      if (!playerPropMarkets[sport].has(market)) {
        await sendJson(response, 400, { error: "Unsupported player prop market." });
        return;
      }

      if (!premium && market !== [...playerPropMarkets[sport]][0]) {
        await sendJson(response, 401, { error: sub ? "Your free trial has ended. Subscribe to unlock every prop market." : "Create a free account to unlock every prop market." });
        return;
      }

      const props = await fetchOddsApi(
        `sports/${encodeURIComponent(sport)}/events/${encodeURIComponent(eventId)}/odds/`,
        { regions, markets: market, oddsFormat: "decimal" }
      );
      if (!premium) {
        // Guests and expired trials get one market and the best-rated players (same ranking the page uses).
        const best = new Map();
        for (const book of props.bookmakers || []) {
          for (const entry of book.markets || []) {
            for (const outcome of entry.outcomes || []) {
              const name = outcome.description || outcome.name;
              const side = String(outcome.name).toLowerCase();
              const key = `${name}|${outcome.point}|${side}`;
              if (!best.has(key) || outcome.price > best.get(key)) best.set(key, outcome.price);
            }
          }
        }
        const strength = new Map();
        for (const [key, price] of best) {
          const [name, point, side] = key.split("|");
          const other = best.get(`${name}|${point}|${side === "over" ? "under" : "over"}`);
          let probability = 0;
          if ((side === "over" || side === "under") && other > 1 && price > 1) probability = (1 / price) / (1 / price + 1 / other);
          strength.set(name, Math.max(strength.get(name) || 0, probability));
        }
        const ranked = [...strength.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
        const keep = new Set(ranked.slice(0, guestPropPlayers));
        const all = new Set(ranked);
        const limited = {
          ...props,
          guest: { shown: keep.size, total: all.size },
          bookmakers: (props.bookmakers || []).map(book => ({
            ...book,
            markets: (book.markets || []).map(entry => ({
              ...entry,
              outcomes: (entry.outcomes || []).filter(outcome => keep.has(outcome.description || outcome.name))
            }))
          }))
        };
        await sendJson(response, 200, limited);
        return;
      }
      await sendJson(response, 200, props);
      return;
    }

    if (url.pathname === "/api/news") {
      const sport = url.searchParams.get("sport") || "basketball_nba";
      const espnSport = espnScoreboardSports[sport];
      if (!espnSport) {
        await sendJson(response, 400, { error: "News is not available for this sport." });
        return;
      }
      const base = `https://site.api.espn.com/apis/site/v2/sports/${espnSport}`;
      const [newsResult, injuryResult] = await Promise.allSettled([
        fetchEspnJson(new URL(`${base}/news?limit=30`)),
        fetchEspnJson(new URL(`${base}/injuries`))
      ]);
      const items = [];
      if (newsResult.status === "fulfilled") {
        for (const article of newsResult.value.articles || []) {
          const link = article.links?.web?.href || "";
          if (!/^https:\/\//.test(link) || !article.headline) continue;
          items.push({
            kind: /bet|odds|prop|fantasy|spread|parlay/i.test(`${article.headline} ${article.description || ""}`) ? "betting" : (article.type === "Recap" ? "recap" : "news"),
            title: article.headline,
            text: article.description || "",
            time: article.published || article.lastModified || "",
            link,
            image: (article.images || []).find(image => image.url && /^https:\/\//.test(image.url) && !image.url.includes("stitcher"))?.url || ""
          });
        }
      }
      if (injuryResult.status === "fulfilled") {
        for (const team of injuryResult.value.injuries || []) {
          for (const injury of team.injuries || []) {
            if (!injury.athlete?.displayName) continue;
            items.push({
              kind: "injury",
              title: `${injury.athlete.displayName} (${team.displayName}) — ${injury.status || "Update"}`,
              text: injury.shortComment || injury.longComment || "",
              time: injury.date || "",
              link: "",
              image: "",
              player: injury.athlete.displayName,
              team: team.displayName
            });
          }
        }
      }
      items.sort((a, b) => Date.parse(b.time || 0) - Date.parse(a.time || 0));
      await sendJson(response, 200, { sport, items: items.slice(0, 80) });
      return;
    }

    if (url.pathname === "/api/matchup-insight") {
      const sport = url.searchParams.get("sport") || "";
      const date = url.searchParams.get("date") || "";
      const home = url.searchParams.get("home") || "";
      const away = url.searchParams.get("away") || "";
      const espnSport = espnScoreboardSports[sport];
      if (!espnSport || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !home || !away || home.length > 100 || away.length > 100) {
        await sendJson(response, 400, { error: "Provide a supported sport, a date and both teams." });
        return;
      }
      const base = `https://site.api.espn.com/apis/site/v2/sports/${espnSport}`;
      const scoreboardUrl = new URL(`${base}/scoreboard`);
      scoreboardUrl.searchParams.set("dates", date.replace(/-/g, ""));
      const scoreboard = await fetchEspnJson(scoreboardUrl);
      const event = (scoreboard.events || []).find(candidate => {
        const competitors = candidate.competitions?.[0]?.competitors || [];
        return teamsMatch(competitors.find(team => team.homeAway === "home")?.team?.displayName, home) &&
          teamsMatch(competitors.find(team => team.homeAway === "away")?.team?.displayName, away);
      });
      if (!event) {
        await sendJson(response, 404, { error: "No matching game in the ESPN feed." });
        return;
      }
      const competitors = event.competitions[0].competitors;
      const injuryFeed = await fetchEspnJson(new URL(`${base}/injuries`)).catch(() => ({ injuries: [] }));
      const scoreOf = competitor => Number(competitor.score?.value ?? competitor.score?.displayValue ?? competitor.score);
      const teams = {};
      await Promise.all(competitors.map(async competitor => {
        const id = competitor.team?.id;
        const record = name => (competitor.records || []).find(entry => entry.name?.toLowerCase() === name)?.summary || "";
        const schedule = await fetchEspnJson(new URL(`${base}/teams/${encodeURIComponent(id)}/schedule`)).catch(() => ({ events: [] }));
        const results = [];
        for (const game of schedule.events || []) {
          const competition = game.competitions?.[0];
          if (!competition?.status?.type?.completed) continue;
          const mine = competition.competitors?.find(entry => entry.team?.id === id);
          const other = competition.competitors?.find(entry => entry.team?.id !== id);
          if (!mine || !other) continue;
          const mineScore = scoreOf(mine);
          const otherScore = scoreOf(other);
          const won = mine.winner === true || (mine.winner === undefined && mineScore > otherScore);
          results.push({ won, margin: Number.isFinite(mineScore - otherScore) ? mineScore - otherScore : 0 });
        }
        const last = results.slice(-5);
        const injuries = (injuryFeed.injuries || [])
          .find(group => String(group.id) === String(id) || teamsMatch(group.displayName, competitor.team?.displayName))
          ?.injuries?.filter(injury => /out|doubtful|questionable|day-to-day/i.test(injury.status || ""))
          .slice(0, 4)
          .map(injury => ({ player: injury.athlete?.displayName || "", status: injury.status || "" })) || [];
        teams[competitor.homeAway] = {
          name: competitor.team?.displayName || "",
          overall: record("overall") || record("total"),
          venue: competitor.homeAway === "home" ? record("home") : record("road"),
          lastFive: { wins: last.filter(game => game.won).length, games: last.length },
          streak: (() => {
            let count = 0;
            for (let index = results.length - 1; index >= 0 && results[index].won === results[results.length - 1].won; index -= 1) count += 1;
            return results.length ? { won: results[results.length - 1].won, count } : null;
          })(),
          avgMargin: last.length ? last.reduce((sum, game) => sum + game.margin, 0) / last.length : 0,
          injuries
        };
      }));
      await sendJson(response, 200, { sport, teams, venue: event.competitions[0].venue?.fullName || "" });
      return;
    }

    if (url.pathname === "/api/live-scores") {
      const sport = url.searchParams.get("sport") || "";
      const date = url.searchParams.get("date") || "";
      const espnSport = espnScoreboardSports[sport];
      if (!espnSport) {
        await sendJson(response, 400, { error: "Live scores are not supported for this sport." });
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        await sendJson(response, 400, { error: "Provide a valid scoreboard date." });
        return;
      }

      const scoreboardUrl = new URL(
        `https://site.api.espn.com/apis/site/v2/sports/${espnSport}/scoreboard`
      );
      scoreboardUrl.searchParams.set("dates", date.replace(/-/g, ""));
      const scoreboard = await fetchEspnJson(scoreboardUrl);
      const events = (scoreboard.events || []).map(event => {
        const competition = event.competitions?.[0];
        const competitors = competition?.competitors || [];
        const home = competitors.find(team => team.homeAway === "home");
        const away = competitors.find(team => team.homeAway === "away");
        const status = competition?.status || event.status || {};
        const statusType = status.type || {};
        const teamSummary = team => team ? {
          name: team.team?.displayName || team.team?.name || "",
          abbreviation: team.team?.abbreviation || "",
          logo: team.team?.logo || team.team?.logos?.[0]?.href || "",
          score: team.score ?? ""
        } : null;
        return {
          sport,
          id: event.id,
          date: event.date || "",
          state: statusType.state || "pre",
          status: statusType.shortDetail || statusType.detail || statusType.description || "",
          period: status.period || 0,
          clock: status.displayClock || "",
          home: teamSummary(home),
          away: teamSummary(away)
        };
      }).filter(event => event.home && event.away);
      await sendJson(response, 200, { sport, events });
      return;
    }

    if (url.pathname === "/api/live-game") {
      const sport = url.searchParams.get("sport") || "";
      const date = url.searchParams.get("date") || "";
      const home = url.searchParams.get("home") || "";
      const away = url.searchParams.get("away") || "";
      const espnSport = espnScoreboardSports[sport];
      if (!liveGameSports.has(sport) || !espnSport) {
        await sendJson(response, 400, {
          error: "Live game tracker is available for NBA, WNBA, NHL, MLB, NFL, and college football games."
        });
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !home || !away || home.length > 100 || away.length > 100) {
        await sendJson(response, 400, { error: "Provide a valid game date and teams." });
        return;
      }

      const espnDate = date.replace(/-/g, "");
      const scoreboardUrl = new URL(
        `https://site.api.espn.com/apis/site/v2/sports/${espnSport}/scoreboard`
      );
      scoreboardUrl.searchParams.set("dates", espnDate);
      const scoreboard = await fetchEspnJson(scoreboardUrl);
      const event = (scoreboard.events || []).find(candidate => {
        const competitors = candidate.competitions?.[0]?.competitors || [];
        const homeTeam = competitors.find(team => team.homeAway === "home");
        const awayTeam = competitors.find(team => team.homeAway === "away");
        return teamsMatch(homeTeam?.team?.displayName, home) &&
          teamsMatch(awayTeam?.team?.displayName, away);
      });

      if (!event) {
        await sendJson(response, 404, {
          error: "ESPN has no matching game on this date. It may not be listed in its scoreboard feed yet."
        });
        return;
      }

      const summaryUrl = new URL(
        `https://site.api.espn.com/apis/site/v2/sports/${espnSport}/summary`
      );
      summaryUrl.searchParams.set("event", event.id);
      const summary = await fetchEspnJson(summaryUrl);
      const competition = summary.header?.competitions?.[0] || event.competitions?.[0];
      const boxScoreTeams = summary.boxscore?.players || [];
      const teamLeaders = summary.leaders || [];
      const status = competition?.status || event.status || {};
      const statusType = status.type || {};
      const isFootball = sport === "americanfootball_nfl" ||
        sport === "americanfootball_ncaaf";
      const isHockey = sport === "icehockey_nhl";
      const isBaseball = sport === "baseball_mlb";
      const teams = (competition?.competitors || []).map(team => {
        const boxScore = boxScoreTeams.find(candidate =>
          candidate.team?.id === team.team?.id ||
          candidate.homeAway === team.homeAway ||
          normalizeTeamName(candidate.team?.displayName) ===
            normalizeTeamName(team.team?.displayName)
        );
        const teamLeaderGroup = teamLeaders.find(candidate =>
          candidate.team?.id === team.team?.id ||
          normalizeTeamName(candidate.team?.displayName) === normalizeTeamName(team.team?.displayName)
        );
        const playerMap = new Map();
        for (const statGroup of boxScore?.statistics || []) {
          const labels = statGroup.labels || statGroup.names || [];
          for (const player of statGroup.athletes || []) {
            if (!player.athlete || player.didNotPlay) continue;
            const playerKey = String(player.athlete.id || player.athlete.displayName);
            let playerEntry = playerMap.get(playerKey);
            if (!playerEntry) {
              playerEntry = {
                id: playerKey,
                name: player.athlete.displayName,
                position: player.athlete.position?.abbreviation || "",
                starter: Boolean(player.starter),
                onCourt: statusType.state === "in" && Boolean(player.active),
                stats: []
              };
              playerMap.set(playerKey, playerEntry);
            }
            const groupName = String(statGroup.name || "").trim() ||
              (isBaseball ? labels.includes("IP") ? "Pitching" : "Batting" : "");
            for (const [index, value] of (player.stats || []).entries()) {
              const label = labels[index] || "";
              playerEntry.stats.push({
                label: (isFootball || isBaseball) && groupName ? `${groupName} ${label}` : label,
                value
              });
            }
          }
        }
        const players = [...playerMap.values()];
        let leaders = (teamLeaderGroup?.leaders || []).map(category => {
          const leader = category.leaders?.[0];
          return leader ? {
            category: category.displayName || category.name || "Leader",
            player: leader.athlete?.displayName || "Player",
            value: leader.displayValue || String(leader.value ?? "")
          } : null;
        }).filter(Boolean);
        if (isBaseball && !leaders.length) {
          const statLeader = (group, label, category, lowerIsBetter = false) => {
            const candidates = players.flatMap(player => {
              const stat = player.stats.find(item => item.label === `${group} ${label}`);
              const value = Number.parseFloat(stat?.value);
              return Number.isFinite(value) ? [{ player, value, displayValue: stat.value }] : [];
            }).filter(candidate => candidate.value > 0);
            candidates.sort((a, b) =>
              (lowerIsBetter ? a.value - b.value : b.value - a.value) ||
              a.player.name.localeCompare(b.player.name)
            );
            const leader = candidates[0];
            if (leader) {
              leaders.push({
                category,
                player: leader.player.name,
                value: leader.displayValue
              });
            }
          };
          statLeader("Batting", "H", "Hits");
          statLeader("Batting", "HR", "Home runs");
          statLeader("Batting", "RBI", "Runs batted in");
          statLeader("Pitching", "K", "Pitcher strikeouts");
          statLeader("Pitching", "ERA", "Pitching ERA", true);
        }

        return {
          name: team.team?.displayName || team.team?.name || "Team",
          id: String(team.team?.id || ""),
          abbreviation: team.team?.abbreviation || "",
          homeAway: team.homeAway,
          score: team.score ?? "0",
          color: team.team?.color || "",
          logo: team.team?.logo || "",
          linescores: (team.linescores || []).map(line => line.displayValue || line.value || ""),
          players,
          leaders
        };
      });
      const venue = summary.gameInfo?.venue?.fullName || event.competitions?.[0]?.venue?.fullName || "";
      const statusLabel = statusType.state === "pre"
        ? "Scheduled"
        : statusType.completed
          ? statusType.description || "Final"
          : statusType.shortDetail || statusType.detail || statusType.description || "Game in progress";
      const sportTitle = sport === "basketball_nba"
        ? "NBA"
        : sport === "basketball_wnba"
          ? "WNBA"
          : sport === "baseball_mlb"
            ? "MLB"
            : sport === "icehockey_nhl"
              ? "NHL"
              : sport === "americanfootball_nfl"
                ? "NFL"
                : "College Football";
      const currentDrive = summary.drives?.current;
      const drivePlays = [
        ...(summary.drives?.previous || []).flatMap(drive =>
          (drive.plays || []).map(play => ({ ...play, team: play.team || drive.team }))
        ),
        ...(currentDrive?.plays || []).map(play => ({
          ...play,
          team: play.team || currentDrive.team
        }))
      ];
      const playSource = isFootball && drivePlays.length
        ? [...(summary.plays || []), ...drivePlays]
        : summary.plays || [];
      const uniquePlays = new Map();
      for (const play of playSource) {
        const playId = String(play.id || play.sequenceNumber || "");
        if (playId) uniquePlays.set(playId, play);
      }
      const teamIdsBySide = Object.fromEntries(
        (competition?.competitors || []).map(team => [
          team.homeAway,
          String(team.team?.id || "")
        ])
      );
      let previousAwayScore = 0;
      let previousHomeScore = 0;
      const orderedPlays = [...uniquePlays.values()]
        .sort((a, b) => Number(a.sequenceNumber || 0) - Number(b.sequenceNumber || 0));
      const playsWithSides = orderedPlays.map(play => {
        const teamId = String(play.team?.id || play.teamId || "");
        const awayScore = play.awayScore === null || play.awayScore === undefined
          ? null
          : Number(play.awayScore);
        const homeScore = play.homeScore === null || play.homeScore === undefined
          ? null
          : Number(play.homeScore);
        let teamSide = teamId && teamId === teamIdsBySide.home
          ? "home"
          : teamId && teamId === teamIdsBySide.away
            ? "away"
            : "";
        if (!teamSide && (awayScore !== null || homeScore !== null)) {
          const awayDelta = awayScore === null ? 0 : awayScore - previousAwayScore;
          const homeDelta = homeScore === null ? 0 : homeScore - previousHomeScore;
          if (awayDelta > homeDelta) teamSide = "away";
          else if (homeDelta > awayDelta) teamSide = "home";
        }
        if (awayScore !== null) previousAwayScore = awayScore;
        if (homeScore !== null) previousHomeScore = homeScore;
        return { play, teamSide };
      });
      const plays = playsWithSides
        .slice(-25)
        .reverse()
        .map(({ play, teamSide }) => ({
          id: String(play.id || play.sequenceNumber || ""),
          period: play.period?.displayValue || "",
          clock: play.clock?.displayValue || "",
          type: play.type?.text || "",
          text: play.text || "",
          teamId: String(play.team?.id || play.teamId || ""),
          teamSide,
          awayScore: play.awayScore ?? null,
          homeScore: play.homeScore ?? null,
          scoring: Boolean(play.scoringPlay)
        }))
        .filter(play => play.text);
      await sendJson(response, 200, {
        sport,
        sportTitle,
        eventId: event.id,
        date: competition?.date || event.date,
        status: statusLabel,
        state: statusType.state || "pre",
        period: status.period || 0,
        periodLabel: statusType.shortDetail || statusType.detail || "",
        clock: status.displayClock || "",
        drive: currentDrive ? {
          team: currentDrive.team?.displayName || "",
          description: currentDrive.description || "",
          start: currentDrive.start?.text || "",
          plays: currentDrive.offensivePlays || 0,
          yards: currentDrive.yards || 0
        } : null,
        situation: isBaseball && summary.situation ? {
          balls: summary.situation.balls ?? null,
          strikes: summary.situation.strikes ?? null,
          outs: summary.situation.outs ?? null,
          batterId: summary.situation.batter?.playerId
            ? String(summary.situation.batter.playerId)
            : "",
          pitcherId: summary.situation.pitcher?.playerId
            ? String(summary.situation.pitcher.playerId)
            : ""
        } : null,
        venue,
        teams,
        plays,
        injuries: (summary.injuries || []).flatMap(group =>
          (group.injuries || []).map(injury => ({
            teamId: String(group.team?.id || ""),
            name: injury.athlete?.displayName || "",
            status: injury.status || injury.type?.description || "",
            detail: injury.shortComment || injury.details?.detail || injury.details?.type || ""
          }))
        ).filter(injury => injury.name),
        updatedAt: new Date().toISOString()
      });
      return;
    }

    if (url.pathname === "/game") {
      const html = await readFile(join(directory, "game.html"));
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end(html);
      return;
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const html = await readFile(join(directory, "index.html"));
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end(html);
      return;
    }

    const soundMatch = url.pathname.match(/^\/sounds\/([\w-]+\.(mp3|wav|ogg|m4a))$/i);
    if (soundMatch) {
      const types = { mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4" };
      try {
        const audio = await readFile(join(directory, "sounds", soundMatch[1]));
        response.writeHead(200, {
          "Content-Type": types[soundMatch[2].toLowerCase()],
          "Cache-Control": "no-cache"
        });
        response.end(audio);
      } catch {
        response.writeHead(404);
        response.end("Not found");
      }
      return;
    }

    response.writeHead(404);
    response.end("Not found");
  } catch (error) {
    console.error("Request failed:", error.message);
    await sendJson(response, error.status || 502, {
      error: error.message || "Unable to retrieve odds."
    });
  }
});

const host = process.env.HOST || "127.0.0.1";
server.listen(port, host, () => {
  console.log(`Odds demo running at http://${host}:${port}`);
  startPushChecker(async (sport, date, home, away) => {
    const params = new URLSearchParams({ sport, date, home, away });
    const reply = await fetch(`http://127.0.0.1:${port}/api/live-game?${params}`, { headers: { "x-wb-internal": internalToken } });
    if (!reply.ok) throw new Error(`live-game ${reply.status}`);
    return reply.json();
  });
});
