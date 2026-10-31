// End-to-end checks of the HTTP server: a real server.mjs runs on a free port with local accounts,
// a throwaway data folder and dry-run mail, so nothing touches Firebase, SMTP or the odds API.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const password = "correct horse battery";

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitFor(check, what, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

async function startServer(extraEnv = {}) {
  const port = await freePort();
  const dataDir = await mkdtemp(join(tmpdir(), "wiselybet-test-"));
  const env = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    DATA_DIR: dataDir,
    FIREBASE_KEY_FILE: join(dataDir, "no-firebase-key.json"),
    FIREBASE_KEY_JSON: "",
    FIREBASE_WEB_JSON: "",
    VAPID_PUBLIC: "",
    VAPID_PRIVATE: "",
    SMTP_USER: "",
    SMTP_PASS: "",
    MAIL_DRY_RUN: "1",
    SUPPORT_EMAIL: "",
    THE_ODDS_API_KEY: "",
    TRIAL_MINUTES: "5",
    NODE_ENV: "test",
    ...extraEnv
  };
  const child = spawn(process.execPath, [join(directory, "server.mjs")], { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitFor(async () => {
      if (child.exitCode !== null) throw new Error(`server.mjs exited early:\n${output}`);
      return fetch(`${base}/healthz`).then(reply => reply.ok, () => false);
    }, "the server to start");
  } catch (error) {
    child.kill();
    throw error;
  }
  return {
    base,
    child,
    output: () => output,
    async stop(signal) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill(signal);
        await exited;
      }
      await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  };
}

let server;
before(async () => { server = await startServer(); });
after(async () => { await server?.stop(); });

function request(path, { method = "GET", body, cookie, headers = {}, redirect = "follow" } = {}) {
  return fetch(server.base + path, {
    method,
    redirect,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body)
  });
}
const get = (path, cookie, options = {}) => request(path, { ...options, cookie });
test("moneyline support is publicly served before account gating", async () => {
  const reply = await get("/moneyline.js");
  assert.equal(reply.status, 200);
  assert.match(reply.headers.get("content-type"), /javascript/);
  assert.match(await reply.text(), /root\.moneylineSupport = support/);
});
const post = (path, body, cookie, headers) => request(path, { method: "POST", body, cookie, headers });
const put = (path, body, cookie) => request(path, { method: "PUT", body, cookie });

function sessionCookie(reply) {
  const match = /wb_session=([^;]*)/.exec(reply.headers.get("set-cookie") || "");
  return match?.[1] ? `wb_session=${match[1]}` : "";
}
async function signUp(username) {
  const reply = await post("/api/auth/signup", { username, password });
  assert.equal(reply.status, 200, await reply.clone().text());
  const cookie = sessionCookie(reply);
  assert.ok(cookie, "sign-up starts a session");
  return cookie;
}
async function logIn(username) {
  const reply = await post("/api/auth/login", { username, password });
  assert.equal(reply.status, 200, await reply.clone().text());
  return sessionCookie(reply);
}
async function savedData(cookie) {
  const reply = await get("/api/user-data", cookie);
  assert.equal(reply.status, 200);
  return (await reply.json()).data;
}
async function save(cookie, data) {
  const reply = await put("/api/user-data", { data }, cookie);
  assert.equal(reply.status, 200, await reply.clone().text());
}

test("health check, legal pages, robots.txt and shared files are public", async () => {
  const health = await get("/healthz");
  assert.equal(await health.text(), "ok");
  assert.equal(health.headers.get("x-content-type-options"), "nosniff");
  assert.match(health.headers.get("content-security-policy"), /default-src 'self'/);
  assert.equal(health.headers.get("strict-transport-security"), null, "HSTS is only sent in production");

  for (const [path, heading] of [["/terms", "Terms of Use"], ["/privacy", "Privacy Policy"], ["/responsible-gaming", "Responsible gaming"]]) {
    const reply = await get(path);
    assert.equal(reply.status, 200, path);
    assert.match(reply.headers.get("content-type"), /^text\/html/);
    const html = await reply.text();
    assert.ok(html.includes(`<h1>${heading}</h1>`), path);
    assert.ok(!html.includes("%SUPPORT_CONTACT%"), `${path} has its contact filled in`);
  }
  assert.match(await (await get("/privacy")).text(), /<strong>Send feedback<\/strong> in the app/, "without SUPPORT_EMAIL the pages point to the feedback form");

  const robots = await get("/robots.txt");
  assert.equal(robots.status, 200);
  assert.match(await robots.text(), /^Disallow: \/api\/$/m);
  for (const [path, type] of [["/legal.css", /^text\/css/], ["/client-errors.js", /^text\/javascript/]]) {
    const reply = await get(path);
    assert.equal(reply.status, 200, path);
    assert.match(reply.headers.get("content-type"), type, path);
  }
});

test("unknown addresses get the branded 404 page; API paths answer in JSON", async () => {
  let reply = await get("/no-such-page");
  assert.equal(reply.status, 404);
  assert.match(reply.headers.get("content-type"), /^text\/html/);
  assert.equal(reply.headers.get("cache-control"), "no-store");
  assert.match(await reply.text(), /This page isn't on the board/);

  reply = await get("/api/no-such-endpoint");
  assert.equal(reply.status, 401, "guests are asked to sign in before anything else");
  reply = await get("/subscribe", undefined, { redirect: "manual" });
  assert.equal(reply.status, 302);
  assert.equal(reply.headers.get("location"), "/login");

  const cookie = await signUp("lost-visitor");
  reply = await get("/api/no-such-endpoint", cookie);
  assert.equal(reply.status, 404);
  assert.deepEqual(await reply.json(), { error: "Not found." });
  reply = await get("/no-such-page", cookie);
  assert.equal(reply.status, 404);
  assert.match(await reply.text(), /This page isn't on the board/);
});

test("feedback needs an account and a real message, is escaped, and is rate limited", async () => {
  assert.equal((await post("/api/feedback", { topic: "idea", message: "A guest trying to send this" })).status, 401);
  const cookie = await signUp("feedback-fan");

  let reply = await post("/api/feedback", { topic: "idea", message: "  too short  " }, cookie);
  assert.equal(reply.status, 400);
  assert.match((await reply.json()).error, /few more words/);

  const details = { page: "/#props", screen: "1280x720", theme: "dark", timeZone: "America/New_York" };
  reply = await post("/api/feedback", { topic: "idea", message: "Please add <b>tennis</b> props.", details }, cookie);
  assert.equal(reply.status, 200);
  const sent = await reply.json();
  assert.equal(sent.dryRun, true);
  assert.equal(sent.subject, "WiselyBet feedback: Idea or request");
  assert.match(sent.text, /^Topic: Idea or request$/m);
  assert.match(sent.text, /^From: feedback-fan$/m);
  assert.match(sent.text, /^Screen: 1280x720$/m);
  assert.match(sent.text, /^Time zone: America\/New_York$/m);
  assert.ok(sent.text.endsWith("Please add <b>tennis</b> props."));
  assert.ok(sent.html.includes("Please add &lt;b&gt;tennis&lt;/b&gt; props."), "the HTML email escapes the message");
  assert.ok(!sent.html.includes("<b>tennis</b>"));
  assert.equal(sent.replyTo, undefined, "a username is not an email address to reply to");

  reply = await post("/api/feedback", { topic: "not-a-topic", message: "Unknown topics are filed under Other." }, cookie);
  const other = await reply.json();
  assert.equal(other.subject, "WiselyBet feedback: Other");
  assert.doesNotMatch(other.text, /^(Screen|Browser|Page):/m, "device details are only sent when the user opts in");

  for (let count = 3; count <= 5; count += 1) {
    assert.equal((await post("/api/feedback", { topic: "bug", message: `Report number ${count} with details` }, cookie)).status, 200);
  }
  reply = await post("/api/feedback", { topic: "bug", message: "One report too many this hour" }, cookie);
  assert.equal(reply.status, 429);
});

test("client error reports are logged once, without query strings, and need no account", async () => {
  const report = {
    kind: "error",
    message: "Uncaught TypeError: boom is not a function",
    source: `${server.base}/game?token=secret-value`,
    line: 12,
    column: 4,
    stack: "TypeError: boom is not a function\n    at render (https://example.test/app.js?v=private:1:2)",
    page: "/game?id=private"
  };
  assert.equal((await post("/api/client-error", report)).status, 204);
  assert.equal((await post("/api/client-error", report)).status, 204, "repeats are accepted but not logged again");
  await waitFor(() => server.output().includes("Client error:"), "the client error log line", 5000);
  await new Promise(resolve => setTimeout(resolve, 300));

  const lines = server.output().split(/\r?\n/).filter(line => line.includes("Client error:"));
  assert.equal(lines.length, 1);
  const logged = JSON.parse(lines[0].slice(lines[0].indexOf("{")));
  assert.equal(logged.kind, "error");
  assert.equal(logged.message, report.message);
  assert.equal(logged.source, `${server.base}/game`);
  assert.equal(logged.page, "/game");
  assert.equal(logged.line, 12);
  assert.ok(!lines[0].includes("secret-value") && !lines[0].includes("private"), "query strings never reach the log");

  assert.equal((await post("/api/client-error", { message: "x".repeat(5000) })).status, 413);
  assert.equal((await post("/api/client-error", report, undefined, { Origin: "https://elsewhere.example" })).status, 403);
});

test("an active break can be extended but not removed, shortened or set too far ahead", async () => {
  const cookie = await signUp("break-taker");
  const now = Date.now();
  const hour = 3_600_000;
  const breakUntil = async () => JSON.parse((await savedData(cookie))["courtside.break.v1"] || "null")?.until;
  const breakFor = until => JSON.stringify({ until, startedAt: now });

  await save(cookie, { "courtside.break.v1": breakFor(now + hour), "courtside.settings.v1": JSON.stringify({ theme: "dark" }) });
  assert.equal(await breakUntil(), now + hour);
  await save(cookie, { "courtside.break.v1": null, "courtside.settings.v1": JSON.stringify({ theme: "light" }) });
  assert.equal(await breakUntil(), now + hour, "an active break can't be removed");
  assert.equal(JSON.parse((await savedData(cookie))["courtside.settings.v1"]).theme, "light", "other keys in the same save still apply");
  await save(cookie, { "courtside.break.v1": breakFor(now + 60_000) });
  assert.equal(await breakUntil(), now + hour, "or shortened");
  await save(cookie, { "courtside.break.v1": breakFor(now + 40 * 24 * hour) });
  assert.equal(await breakUntil(), now + hour, "or pushed beyond 31 days");
  await save(cookie, { "courtside.break.v1": breakFor(now + 2 * hour) });
  assert.equal(await breakUntil(), now + 2 * hour, "but it can be extended");

  const finished = await signUp("break-finished");
  await save(finished, { "courtside.break.v1": JSON.stringify({ until: now - 1000, startedAt: now - hour }) });
  await save(finished, { "courtside.break.v1": null });
  assert.equal((await savedData(finished))["courtside.break.v1"], undefined, "a finished break can be cleared");
});

test("deleting an account needs DELETE, signs out every session and frees the name", async () => {
  assert.equal((await post("/api/account/delete", { confirm: "DELETE" })).status, 401);
  const first = await signUp("short-lived");
  const second = await logIn("short-lived");
  await save(first, { "courtside.settings.v1": JSON.stringify({ theme: "light" }) });

  assert.equal((await post("/api/account/delete", {}, first)).status, 400);
  assert.equal((await post("/api/account/delete", { confirm: "delete" }, first)).status, 400);
  assert.equal((await get("/api/auth/me", first)).status, 200, "a refused request keeps the account");

  const reply = await post("/api/account/delete", { confirm: "DELETE" }, first);
  assert.equal(reply.status, 200);
  assert.deepEqual(await reply.json(), { ok: true });
  assert.match(reply.headers.get("set-cookie"), /^wb_session=;.*Max-Age=0/);
  for (const cookie of [first, second]) {
    assert.equal((await get("/api/auth/me", cookie)).status, 401);
    assert.equal((await get("/api/user-data", cookie)).status, 401);
    assert.equal((await put("/api/user-data", { data: { "courtside.settings.v1": "{}" } }, cookie)).status, 401);
  }
  assert.equal((await post("/api/auth/login", { username: "short-lived", password })).status, 401);

  const again = await signUp("short-lived");
  const fresh = await (await get("/api/user-data", again)).json();
  assert.deepEqual(fresh.data, {}, "nothing from the deleted account carries over");
  assert.equal(fresh.subscription.status, "trial");
});

test("production adds HSTS, shows SUPPORT_EMAIL and shuts down cleanly on SIGTERM", async () => {
  const production = await startServer({ NODE_ENV: "production", SUPPORT_EMAIL: "help@example.com" });
  try {
    const health = await fetch(`${production.base}/healthz`);
    assert.equal(health.headers.get("strict-transport-security"), "max-age=31536000");
    const terms = await (await fetch(`${production.base}/terms`)).text();
    assert.ok(terms.includes('<a href="mailto:help@example.com">help@example.com</a>'));
  } finally {
    // Windows has no SIGTERM: kill() there ends the process at once, so the graceful path is checked on Linux/macOS.
    if (process.platform !== "win32") {
      // "close" waits for the output streams too, so the shutdown message has arrived.
      const closed = once(production.child, "close");
      production.child.kill("SIGTERM");
      const [code] = await closed;
      assert.equal(code, 0);
      assert.match(production.output(), /SIGTERM received, closing the server\./);
    }
    await production.stop();
  }
});
