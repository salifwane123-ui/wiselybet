const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");

const html = readFileSync(join(__dirname, "index.html"), "utf8");
const clientSource = html.slice(html.indexOf("(function setupPush()"), html.indexOf("renderHistory();", html.indexOf("(function setupPush()")));
const serverSource = readFileSync(join(__dirname, "push.mjs"), "utf8");
const settle = () => new Promise(resolve => setImmediate(resolve));
const response = (data, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => data });

async function client({ sub = null, reply = () => response({}), ios = false, standalone = true, getError } = {}) {
  const calls = [];
  const elements = {};
  for (const id of ["#set-push", "#push-status", "#push-test"]) {
    elements[id] = { checked: false, hidden: true, disabled: false, listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; } };
  }
  let subscription = sub;
  const fresh = { endpoint: "new", toJSON: () => ({ endpoint: "new" }) };
  const context = {
    document: { querySelector: id => elements[id] },
    navigator: {
      userAgent: ios ? "iPhone" : "Chrome",
      serviceWorker: { ready: Promise.resolve({ pushManager: {
        async getSubscription() { if (getError) throw new Error(getError); return subscription; },
        async subscribe() { calls.push("subscribe"); subscription = fresh; return fresh; }
      } }) }
    },
    Notification: { permission: "granted", requestPermission() { calls.push("permission"); return Promise.resolve("granted"); } },
    PushManager: function () {},
    matchMedia: () => ({ matches: standalone }),
    wiselyUser: "tester",
    atob: value => Buffer.from(value, "base64").toString("binary"),
    Uint8Array, Intl,
    async fetch(path, options) { calls.push(path); return reply(path, options); }
  };
  context.window = context;
  runInNewContext(clientSource, context);
  await settle();
  return { elements, calls, toggle: elements["#set-push"], status: elements["#push-status"], testButton: elements["#push-test"] };
}

test("phone permission is requested from the tap before fetching the server key", async () => {
  const app = await client({ reply: path => response(path === "/api/push/key" ? { key: "AQID" } : {}) });
  app.toggle.checked = true;
  await app.toggle.listeners.change();
  assert.deepEqual(app.calls.slice(0, 2), ["permission", "/api/push/key"]);
  assert.equal(app.toggle.checked, true);
});

test("failed key requests display the server error rather than claiming keys are missing", async () => {
  const app = await client({ reply: () => response({ error: "Please sign in." }, false) });
  app.toggle.checked = true;
  await app.toggle.listeners.change();
  assert.equal(app.status.textContent, "Please sign in.");
  assert.equal(app.toggle.checked, false);
  assert.equal(app.toggle.disabled, false);
});

test("failed server unsubscribe keeps the browser subscription and toggle on", async () => {
  let removed = false;
  const app = await client({
    sub: { endpoint: "old", unsubscribe: async () => { removed = true; return true; } },
    reply: () => response({ error: "Could not save." }, false)
  });
  app.toggle.checked = false;
  await app.toggle.listeners.change();
  assert.equal(removed, false);
  assert.equal(app.toggle.checked, true);
  assert.equal(app.status.textContent, "Could not save.");
});

test("rotated VAPID keys remove the old subscription before resubscribing", async () => {
  let removed = false;
  const app = await client({
    sub: { endpoint: "old", options: { applicationServerKey: Uint8Array.from([4, 5, 6]).buffer }, unsubscribe: async () => { removed = true; return true; } },
    reply: path => response(path === "/api/push/key" ? { key: "AQID" } : {})
  });
  app.toggle.checked = true;
  await app.toggle.listeners.change();
  assert.equal(removed, true);
  assert.deepEqual(app.calls, ["permission", "/api/push/key", "/api/push/unsubscribe", "subscribe", "/api/push/subscribe"]);
});

test("a zero-delivery test is not reported as sent", async () => {
  const app = await client({ reply: () => response({ sent: 0 }) });
  await app.testButton.listeners.click();
  assert.match(app.status.textContent, /not accepted/);
  assert.equal(app.testButton.disabled, false);
});

test("test network errors surface and restore the button", async () => {
  const app = await client({ reply: () => { throw new Error("Network unavailable"); } });
  await app.testButton.listeners.click();
  assert.equal(app.status.textContent, "Network unavailable");
  assert.equal(app.testButton.disabled, false);
});

test("iPhone users must install the Home Screen app even if PushManager exists", async () => {
  const app = await client({ ios: true, standalone: false });
  assert.equal(app.toggle.disabled, true);
  assert.match(app.status.textContent, /Add to Home Screen/);
});

test("subscription read errors are visible rather than silently showing Off", async () => {
  const app = await client({ getError: "Subscription unavailable" });
  assert.equal(app.status.textContent, "Subscription unavailable");
  assert.equal(app.testButton.hidden, true);
});

function server(context) {
  const source = serverSource.slice(serverSource.indexOf("async function readList"), serverSource.indexOf("// ---- Background checker"));
  runInNewContext(source.replace(/^export /gm, ""), context);
  return context;
}

test("test endpoint rejects disabled push and zero accepted deliveries", async () => {
  const context = server({
    pushEnabled: false, pushDataKey: "push",
    getUserData: async () => ({ push: JSON.stringify([{ endpoint: "test" }]) }),
    updateUserData: async () => {},
    webpush: { sendNotification: async () => { throw Object.assign(new Error("Rejected"), { statusCode: 403 }); } },
    console: { error() {} }
  });
  await assert.rejects(context.sendTest("tester"), error => error.status === 503);
  context.pushEnabled = true;
  await assert.rejects(context.sendTest("tester"), error => error.status === 502);
  context.webpush.sendNotification = async () => {};
  assert.equal((await context.sendTest("tester")).sent, 1);
});

test("subscription storage errors propagate instead of looking like an unsubscribed phone", async () => {
  const context = server({ pushDataKey: "push", getUserData: async () => { throw new Error("Database unavailable"); } });
  await assert.rejects(context.readList("tester"), /Database unavailable/);
  context.getUserData = async () => ({ push: "{}" });
  await assert.rejects(context.readList("tester"), /subscriptions are invalid/);
});
