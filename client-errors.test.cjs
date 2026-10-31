// The browser error reporter shared by every page (client-errors.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "client-errors.js"), "utf8");
const origin = "https://wiselybet.onrender.com";

function loadReporter(fetchImpl) {
  const listeners = {};
  const sent = [];
  const context = {
    location: { origin, pathname: "/game" },
    fetch: fetchImpl || ((url, options) => {
      sent.push({ url, options, body: JSON.parse(options.body) });
      return Promise.resolve({ ok: true });
    }),
    addEventListener(type, listener) { listeners[type] = listener; }
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return { sent, error: event => listeners.error(event), rejection: event => listeners.unhandledrejection(event) };
}

test("reports a same-origin script error with where it happened", () => {
  const page = loadReporter();
  page.error({ message: "Uncaught TypeError: boom is not a function", filename: `${origin}/?embed=1`, lineno: 120, colno: 9, error: { stack: "TypeError: boom\n    at render" } });
  assert.equal(page.sent.length, 1);
  const [{ url, options, body }] = page.sent;
  assert.equal(url, "/api/client-error");
  assert.equal(options.method, "POST");
  assert.equal(options.keepalive, true);
  assert.equal(options.credentials, "same-origin");
  assert.deepEqual(body, {
    kind: "error",
    message: "Uncaught TypeError: boom is not a function",
    source: `${origin}/?embed=1`,
    line: 120,
    column: 9,
    stack: "TypeError: boom\n    at render",
    page: "/game"
  });
});

test("ignores resource failures, browser noise, network drops and other sites' scripts", () => {
  const page = loadReporter();
  page.error(undefined);
  page.error({ message: "", filename: `${origin}/` });
  page.error({ message: "Script error.", filename: "" });
  page.error({ message: "ResizeObserver loop completed with undelivered notifications.", filename: `${origin}/` });
  page.error({ message: "Uncaught TypeError: Failed to fetch", filename: `${origin}/` });
  page.error({ message: "Uncaught Error: injected", filename: "chrome-extension://abcdef/content.js" });
  page.error({ message: "Uncaught Error: ad script", filename: "https://ads.example.com/tag.js" });
  page.rejection({ reason: { name: "AbortError", message: "The user aborted a request." } });
  page.rejection({ reason: new TypeError("Load failed") });
  page.rejection({ reason: new TypeError("NetworkError when attempting to fetch resource.") });
  assert.equal(page.sent.length, 0);
});

test("reports unhandled promise rejections", () => {
  const page = loadReporter();
  page.rejection({ reason: Object.assign(new Error("Parlay save failed"), { stack: "Error: Parlay save failed\n    at save" }) });
  page.rejection({ reason: "plain text reason" });
  assert.deepEqual(page.sent.map(({ body }) => [body.kind, body.message, body.source, body.line]), [
    ["rejection", "Parlay save failed", "", 0],
    ["rejection", "plain text reason", "", 0]
  ]);
  assert.equal(page.sent[0].body.stack, "Error: Parlay save failed\n    at save");
});

test("sends at most five reports per page load and trims long messages", () => {
  const page = loadReporter();
  for (let count = 0; count < 8; count += 1) page.error({ message: `Uncaught Error: number ${count} ${"x".repeat(400)}`, filename: `${origin}/` });
  assert.equal(page.sent.length, 5);
  assert.equal(page.sent[0].body.message.length, 300);
});

test("a failing report never causes another error", async () => {
  const throwing = loadReporter(() => { throw new Error("blocked by an extension"); });
  assert.doesNotThrow(() => throwing.error({ message: "Uncaught Error: one", filename: `${origin}/` }));
  const offline = loadReporter(() => Promise.reject(new Error("offline")));
  offline.error({ message: "Uncaught Error: two", filename: `${origin}/` });
  await new Promise(resolve => setImmediate(resolve));
});
