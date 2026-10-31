const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");

const source = [...readFileSync(join(__dirname, "index.html"), "utf8").matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).find(script => script.includes("// Account sync:"));
const trackerKey = "courtside.trackers.v1";
const parlayKey = "courtside.parlays.v1";
const journalKey = "wiselybet.pendingSync.v1:tester";

function setup({ initial = {}, server = {}, status = 200, username = "tester" } = {}) {
  class Storage {
    constructor() { this.values = new Map(Object.entries(initial)); }
    get length() { return this.values.size; }
    key(index) { return [...this.values.keys()][index]; }
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) { this.values.set(key, String(value)); }
    removeItem(key) { this.values.delete(key); }
  }
  const localStorage = new Storage();
  const timers = new Map();
  const events = {};
  const requests = [];
  const syncStatus = { hidden: true, textContent: "" };
  let nextTimer = 0;
  const context = {
    Storage, localStorage,
    document: { querySelector: () => syncStatus },
    console: { error() {} },
    setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
    XMLHttpRequest: class {
      status = status;
      responseText = JSON.stringify({ username, data: server });
      open() {}
      send() {}
    },
    fetch(url, options) {
      return new Promise((resolve, reject) => requests.push({ data: JSON.parse(options.body).data, resolve, reject }));
    },
    addEventListener(name, listener) { events[name] = listener; }
  };
  context.window = context;
  runInNewContext(source, context);
  return {
    localStorage, requests, events, syncStatus,
    runTimer() {
      const [id, callback] = timers.entries().next().value;
      timers.delete(id);
      callback();
    }
  };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test("refresh replays an unacknowledged pick instead of stale server data", () => {
  const app = setup({
    initial: { [trackerKey]: '["new pick"]', [journalKey]: JSON.stringify({ [trackerKey]: '["new pick"]' }) },
    server: { [trackerKey]: "[]" }
  });
  assert.equal(app.localStorage.getItem(trackerKey), '["new pick"]');
  app.runTimer();
  assert.equal(app.requests[0].data[trackerKey], '["new pick"]');
});

test("edits are journaled immediately, before the debounce timer fires", () => {
  const app = setup();
  app.localStorage.setItem(trackerKey, '["pick"]');
  assert.equal(JSON.parse(app.localStorage.getItem(journalKey))[trackerKey], '["pick"]');
  assert.equal(app.requests.length, 0);
});

test("failed HTTP saves remain pending and retry without discarding picks", async () => {
  const app = setup();
  app.localStorage.setItem(trackerKey, '["pick"]');
  app.runTimer();
  app.requests[0].resolve({ ok: false, status: 500 });
  await settle();
  assert.equal(app.syncStatus.hidden, false);
  assert.equal(JSON.parse(app.localStorage.getItem(journalKey))[trackerKey], '["pick"]');
  app.runTimer();
  assert.equal(app.requests[1].data[trackerKey], '["pick"]');
  app.requests[1].resolve({ ok: true });
  await settle();
  assert.equal(app.localStorage.getItem(journalKey), null);
  assert.equal(app.syncStatus.hidden, true);
});

test("saves are serialized and older acknowledgements do not erase newer edits", async () => {
  const app = setup();
  app.localStorage.setItem(trackerKey, '["first"]');
  app.runTimer();
  app.localStorage.setItem(trackerKey, '["second"]');
  app.runTimer();
  assert.equal(app.requests.length, 1);
  app.requests[0].resolve({ ok: true });
  await settle();
  assert.equal(JSON.parse(app.localStorage.getItem(journalKey))[trackerKey], '["second"]');
  app.runTimer();
  assert.equal(app.requests[1].data[trackerKey], '["second"]');
});

test("pending removals and parlay assignments survive refresh together", () => {
  const pending = { [trackerKey]: '["assigned pick"]', [parlayKey]: null };
  const app = setup({
    initial: { [journalKey]: JSON.stringify(pending) },
    server: { [trackerKey]: "[]", [parlayKey]: '["deleted parlay"]' }
  });
  assert.equal(app.localStorage.getItem(trackerKey), pending[trackerKey]);
  assert.equal(app.localStorage.getItem(parlayKey), null);
  app.runTimer();
  assert.deepEqual(app.requests[0].data, pending);
});

test("another account never receives a previous account's pending edits", () => {
  const app = setup({
    username: "other",
    initial: { "wiselybet.user": "tester", [trackerKey]: '["private pick"]', [journalKey]: JSON.stringify({ [trackerKey]: '["private pick"]' }) },
    server: { [trackerKey]: "[]" }
  });
  assert.equal(app.localStorage.getItem(trackerKey), "[]");
  assert.ok(app.localStorage.getItem(journalKey));
  assert.equal(app.requests.length, 0);
});

test("account load errors keep the local copy and surface a warning", () => {
  const app = setup({ initial: { [trackerKey]: '["pick"]' }, status: 503 });
  assert.equal(app.localStorage.getItem(trackerKey), '["pick"]');
  assert.equal(app.syncStatus.hidden, false);
});

test("network failures retain durable edits until an online retry succeeds", async () => {
  const app = setup();
  app.localStorage.setItem(trackerKey, '["pick"]');
  app.events.pagehide();
  app.requests[0].reject(new Error("Offline"));
  await settle();
  assert.ok(app.localStorage.getItem(journalKey));
  app.events.online();
  assert.equal(app.requests[1].data[trackerKey], '["pick"]');
});

test("Firestore saves merge against the transaction snapshot and replace the data map", async () => {
  const authSource = readFileSync(join(__dirname, "auth.mjs"), "utf8");
  const start = authSource.indexOf("export async function updateUserData(");
  const end = authSource.indexOf("// Writes the email", start);
  let saved = { data: { [trackerKey]: "[]", "courtside.push.v1": '["phone"]' } };
  let writes = Promise.resolve();
  const mergeFields = [];
  const reference = {};
  const db = {
    collection() { return { doc: () => reference }; },
    runTransaction(callback) {
      writes = writes.then(() => callback({
        async get(ref) {
          assert.equal(ref, reference);
          return { exists: true, data: () => saved };
        },
        set(ref, update, options) {
          assert.equal(ref, reference);
          mergeFields.push(options.mergeFields);
          saved = { ...saved, ...update };
        }
      }));
      return writes;
    }
  };
  const context = {
    firebaseEnabled: true, firebase: async () => ({ db }), firebaseNames: new Map(),
    pushDataKey: "courtside.push.v1", maxDataBytes: 1_000_000, Buffer,
    deletedUsers: new Set(), breakDataKey: "courtside.break.v1", breakUntil: () => 0, maxBreakMs: 31 * 86_400_000,
    httpError: (status, message) => Object.assign(new Error(message), { status })
  };
  runInNewContext(authSource.slice(start, end).replace("export ", ""), context);
  await Promise.all([
    context.updateUserData("tester", { data: { [trackerKey]: '[{"name":"Pick"}]' } }),
    context.updateUserData("tester", { data: { [parlayKey]: '[{"id":"parlay"}]' } })
  ]);
  assert.equal(saved.data[trackerKey], '[{"name":"Pick"}]');
  assert.equal(saved.data[parlayKey], '[{"id":"parlay"}]');
  assert.equal(saved.data["courtside.push.v1"], '["phone"]');
  await context.updateUserData("tester", { data: { [parlayKey]: null, "courtside.push.v1": null } });
  assert.equal(saved.data[parlayKey], undefined);
  assert.equal(saved.data["courtside.push.v1"], '["phone"]');
  assert.ok(mergeFields.every(fields => fields.includes("data")));
  assert.equal(saved.trackedPlayers[0].name, "Pick");
  assert.equal(saved.parlays.length, 0);
});
