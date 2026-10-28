import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dataDirectory = process.env.DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), "data");
const usersFile = join(dataDirectory, "users.json");
const sessionsFile = join(dataDirectory, "sessions.json");
const cookieName = "wb_session";
const sessionMs = 30 * 24 * 3_600_000;
const maxDataBytes = 1_000_000;

// Firebase mode: Firebase Authentication proves who the user is, Firestore stores their data.
// It turns on when both files exist; otherwise the local JSON accounts below are used.
const appDirectory = dirname(fileURLToPath(import.meta.url));
const firebaseKeyFile = process.env.FIREBASE_KEY_FILE || join(appDirectory, "firebase-key.json");
const firebaseWebFile = join(appDirectory, "firebase-web.json");
// On a host, the same JSON can come from environment variables so no key file is uploaded.
const firebaseKeyEnv = process.env.FIREBASE_KEY_JSON || "";
const firebaseWebEnv = process.env.FIREBASE_WEB_JSON || "";
export const firebaseEnabled = (!!firebaseKeyEnv || existsSync(firebaseKeyFile)) && (!!firebaseWebEnv || existsSync(firebaseWebFile));
export function firebaseWebConfig() {
  if (!firebaseEnabled) return null;
  try {
    const { apiKey, authDomain, projectId, appId } = JSON.parse(firebaseWebEnv || readFileSync(firebaseWebFile, "utf8"));
    return { apiKey, authDomain, projectId, appId };
  } catch {
    return null;
  }
}
const firebaseNames = new Map();
let firebasePromise = null;
function firebase() {
  firebasePromise ||= (async () => {
    const { initializeApp, cert } = await import("firebase-admin/app");
    const { getAuth } = await import("firebase-admin/auth");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app = initializeApp({ credential: cert(JSON.parse(firebaseKeyEnv || readFileSync(firebaseKeyFile, "utf8"))) });
    return { auth: getAuth(app), db: getFirestore(app) };
  })();
  return firebasePromise;
}

let users = {};
let sessions = {};
let loaded = false;
let writeChain = Promise.resolve();

async function load() {
  if (loaded) return;
  loaded = true;
  for (const [file, assign] of [[usersFile, value => { users = value; }], [sessionsFile, value => { sessions = value; }]]) {
    try {
      const parsed = JSON.parse(await readFile(file, "utf8"));
      if (parsed && typeof parsed === "object") assign(parsed);
    } catch { /* first run */ }
  }
  const now = Date.now();
  for (const [id, session] of Object.entries(sessions)) if (session.expires < now) delete sessions[id];
}

// Writes are serialized and atomic (temp file then rename) so a crash cannot corrupt the account file.
function persist() {
  writeChain = writeChain.then(async () => {
    await mkdir(dataDirectory, { recursive: true });
    for (const [file, value] of [[usersFile, users], [sessionsFile, sessions]]) {
      await writeFile(`${file}.tmp`, JSON.stringify(value), { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    }
  }).catch(error => console.error("Could not save accounts:", error.message));
  return writeChain;
}

const hashToken = token => createHash("sha256").update(token).digest("hex");
const hashPassword = (password, salt) => scryptSync(password, Buffer.from(salt, "hex"), 64).toString("hex");

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseCookies(request) {
  const cookies = {};
  for (const part of String(request.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

const firebaseSessionMs = 14 * 24 * 3_600_000;

// Trades a fresh Firebase ID token for our own HttpOnly session cookie.
export async function firebaseSignIn(body, response, address) {
  if (!firebaseEnabled) throw httpError(404, "Firebase sign-in is not set up.");
  checkAttempts([`ip:${address}`]);
  const idToken = String(body?.idToken ?? "");
  if (idToken.length < 20 || idToken.length > 5000) throw httpError(400, "Invalid sign-in.");
  const { auth } = await firebase();
  try {
    const decoded = await auth.verifyIdToken(idToken);
    // Only accept a sign-in that just happened, not an old token.
    if (Date.now() / 1000 - decoded.auth_time > 300) throw new Error("stale");
    // Email/password accounts must have a verified address; Google accounts arrive verified.
    if (!decoded.email_verified) throw new Error("unverified");
    const cookie = await auth.createSessionCookie(idToken, { expiresIn: firebaseSessionMs });
    setCookie(response, cookie, firebaseSessionMs / 1000);
    const name = decoded.email || decoded.name || "Account";
    firebaseNames.set(decoded.uid, name);
    return { username: name };
  } catch {
    noteFailure([`ip:${address}`]);
    throw httpError(401, "Sign-in could not be verified. Try again.");
  }
}

export async function getSessionUser(request) {
  if (firebaseEnabled) {
    const cookie = parseCookies(request)[cookieName];
    if (!cookie) return null;
    try {
      const { auth } = await firebase();
      const decoded = await auth.verifySessionCookie(cookie);
      firebaseNames.set(decoded.uid, decoded.email || decoded.name || "Account");
      return decoded.uid;
    } catch {
      return null;
    }
  }
  await load();
  const token = parseCookies(request)[cookieName];
  if (!token) return null;
  const session = sessions[hashToken(token)];
  if (!session || session.expires < Date.now() || !users[session.user]) return null;
  return session.user;
}

function setCookie(response, token, maxAgeSeconds) {
  response.setHeader("Set-Cookie", `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
}

async function startSession(response, userKey) {
  const token = randomBytes(32).toString("hex");
  sessions[hashToken(token)] = { user: userKey, expires: Date.now() + sessionMs };
  await persist();
  setCookie(response, token, sessionMs / 1000);
}

// Failed logins are limited per address and per account to slow down password guessing.
const failures = new Map();
function checkAttempts(keys) {
  const now = Date.now();
  for (const key of keys) {
    const entry = failures.get(key);
    if (entry && entry.reset > now && entry.count >= 8) throw httpError(429, "Too many attempts. Try again in a few minutes.");
  }
}
function noteFailure(keys) {
  const now = Date.now();
  for (const key of keys) {
    const entry = failures.get(key);
    if (!entry || entry.reset < now) failures.set(key, { count: 1, reset: now + 15 * 60_000 });
    else entry.count += 1;
  }
}
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of failures) if (entry.reset < now) failures.delete(key);
}, 60_000).unref();

function readCredentials(body) {
  const username = String(body?.username ?? "").trim();
  const password = String(body?.password ?? "");
  if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username)) {
    throw httpError(400, "Username must be 3-30 characters: letters, numbers, dots, dashes or underscores.");
  }
  if (password.length > 200) throw httpError(400, "Password is too long.");
  return { username, password };
}

export async function signUp(body, response, address) {
  if (firebaseEnabled) throw httpError(400, "Use the Firebase sign-in on the login page.");
  await load();
  const { username, password } = readCredentials(body);
  if (password.length < 8) throw httpError(400, "Password must be at least 8 characters.");
  checkAttempts([`ip:${address}`]);
  const key = username.toLowerCase();
  if (users[key]) throw httpError(409, "That username is already taken.");
  if (Object.keys(users).length >= 500) throw httpError(403, "Sign-ups are closed.");
  const salt = randomBytes(16).toString("hex");
  users[key] = { username, salt, hash: hashPassword(password, salt), createdAt: new Date().toISOString(), data: {} };
  await startSession(response, key);
  return { username };
}

export async function logIn(body, response, address) {
  if (firebaseEnabled) throw httpError(400, "Use the Firebase sign-in on the login page.");
  await load();
  const { username, password } = readCredentials(body);
  const key = username.toLowerCase();
  const limits = [`ip:${address}`, `user:${key}`];
  checkAttempts(limits);
  const user = users[key];
  // Hash even for unknown users so response time does not reveal which usernames exist.
  const salt = user?.salt || "00".repeat(16);
  const candidate = Buffer.from(hashPassword(password, salt), "hex");
  const expected = Buffer.from(user?.hash || "00".repeat(64), "hex");
  if (!user || !timingSafeEqual(candidate, expected)) {
    noteFailure(limits);
    throw httpError(401, "Wrong username or password.");
  }
  await startSession(response, key);
  return { username: user.username };
}

export async function logOut(request, response) {
  if (firebaseEnabled) {
    setCookie(response, "", 0);
    return;
  }
  await load();
  const token = parseCookies(request)[cookieName];
  if (token) {
    delete sessions[hashToken(token)];
    await persist();
  }
  setCookie(response, "", 0);
}

export async function getUserData(userKey) {
  if (firebaseEnabled) {
    const { db } = await firebase();
    const snapshot = await db.collection("users").doc(userKey).get();
    return snapshot.exists ? snapshot.data().data || {} : {};
  }
  await load();
  return users[userKey]?.data || {};
}

// Stores only the app's own "courtside.*" keys. A null value deletes a key.
export async function updateUserData(userKey, body) {
  if (!firebaseEnabled) await load();
  const user = firebaseEnabled ? {} : users[userKey];
  if (!user || !body || typeof body.data !== "object" || !body.data || Array.isArray(body.data)) {
    throw httpError(400, "Invalid data.");
  }
  const next = { ...(firebaseEnabled ? await getUserData(userKey) : user.data) };
  for (const [key, value] of Object.entries(body.data)) {
    if (!/^courtside\.[\w.-]{1,60}$/.test(key)) continue;
    if (value === null) delete next[key];
    else if (typeof value === "string") next[key] = value;
  }
  if (Object.keys(next).length > 40 || Buffer.byteLength(JSON.stringify(next)) > maxDataBytes) {
    throw httpError(413, "Saved data is too large.");
  }
  if (firebaseEnabled) {
    const { db } = await firebase();
    // Readable copies so the tracked players and parlays can be browsed in the Firebase console.
    const readable = {};
    for (const [field, key] of [["trackedPlayers", "courtside.trackers.v1"], ["parlays", "courtside.parlays.v1"]]) {
      try {
        const parsed = JSON.parse(next[key] || "[]");
        readable[field] = (Array.isArray(parsed) ? parsed : []).slice(0, 50).map(item => {
          const clean = {};
          for (const [name, value] of Object.entries(item || {})) {
            if (["string", "number", "boolean"].includes(typeof value)) clean[name] = value;
          }
          return clean;
        });
      } catch { readable[field] = []; }
    }
    const email = firebaseNames.get(userKey);
    await db.collection("users").doc(userKey).set({ ...(email ? { email } : {}), data: next, ...readable, updatedAt: new Date().toISOString() }, { merge: true });
    return;
  }
  user.data = next;
  await persist();
}

// Writes the email to Firestore "mail" in the format of Firebase's Trigger Email extension, which sends it.
export async function queueEmail(to, message) {
  if (!firebaseEnabled) return false;
  const { db } = await firebase();
  await db.collection("mail").add({ to, message: { subject: message.subject, text: message.text, html: message.html }, createdAt: new Date().toISOString() });
  return true;
}

// Records that a signed-in user is active in Firestore (presence/{uid}), at most once a minute per user.
const lastReported = new Map();
export function reportActive(userKey) {
  if (!firebaseEnabled || Date.now() - (lastReported.get(userKey) || 0) < 60_000) return;
  lastReported.set(userKey, Date.now());
  firebase()
    .then(({ db }) => db.collection("presence").doc(userKey).set({
      email: firebaseNames.get(userKey) || "",
      lastActiveAt: new Date().toISOString()
    }, { merge: true }))
    .catch(error => {
      lastReported.delete(userKey);
      console.error("Could not report active user:", error.message);
    });
}

// Free trial and subscription. The clock lives on the server, so the page can't extend it.
const trialMs = Number(process.env.TRIAL_MINUTES || 5) * 60_000;
export const subscriptionPlans = {
  monthly: { label: "Monthly", days: 30 },
  yearly: { label: "Yearly", days: 365 }
};
// No payment provider is connected yet, so subscribing is a demo unless this is turned off.
export const subscriptionsDemo = process.env.SUBSCRIPTIONS_DEMO !== "0";
const subscriptions = new Map();

async function readSubscription(userKey) {
  if (firebaseEnabled) {
    const { db } = await firebase();
    const snapshot = await db.collection("users").doc(userKey).get();
    const saved = snapshot.exists ? snapshot.data() : {};
    return { trialStartedAt: saved.trialStartedAt || 0, plan: saved.plan || "", planUntil: saved.planUntil || 0 };
  }
  await load();
  const user = users[userKey] || {};
  return { trialStartedAt: user.trialStartedAt || 0, plan: user.plan || "", planUntil: user.planUntil || 0 };
}

async function writeSubscription(userKey, record) {
  if (firebaseEnabled) {
    const { db } = await firebase();
    await db.collection("users").doc(userKey).set(record, { merge: true });
    return;
  }
  if (users[userKey]) {
    Object.assign(users[userKey], record);
    await persist();
  }
}

export async function getSubscription(userKey) {
  let record = subscriptions.get(userKey);
  if (!record) {
    try {
      record = await readSubscription(userKey);
    } catch (error) {
      console.error("Could not read subscription:", error.message);
      record = { trialStartedAt: 0, plan: "", planUntil: 0 };
    }
    if (!record.trialStartedAt) {
      record.trialStartedAt = Date.now();
      try { await writeSubscription(userKey, { trialStartedAt: record.trialStartedAt }); } catch (error) {
        console.error("Could not save trial start:", error.message);
      }
    }
    subscriptions.set(userKey, record);
  }
  const now = Date.now();
  const trialEndsAt = record.trialStartedAt + trialMs;
  const status = record.planUntil > now ? "active" : now < trialEndsAt ? "trial" : "expired";
  return {
    status,
    plan: status === "active" ? record.plan : "",
    planUntil: status === "active" ? record.planUntil : 0,
    trialEndsAt,
    remainingMs: status === "trial" ? trialEndsAt - now : 0,
    serverNow: now
  };
}

export async function subscribe(userKey, planKey) {
  const plan = subscriptionPlans[planKey];
  if (!plan) throw httpError(400, "Choose a plan.");
  if (!subscriptionsDemo) throw httpError(501, "Payments are not connected yet.");
  await getSubscription(userKey);
  const record = subscriptions.get(userKey);
  const start = Math.max(Date.now(), record.planUntil || 0);
  record.plan = planKey;
  record.planUntil = start + plan.days * 86_400_000;
  await writeSubscription(userKey, { plan: record.plan, planUntil: record.planUntil, subscribedAt: new Date().toISOString() });
  return getSubscription(userKey);
}

export function displayName(userKey) {
  if (firebaseEnabled) return firebaseNames.get(userKey) || "";
  return users[userKey]?.username || "";
}
