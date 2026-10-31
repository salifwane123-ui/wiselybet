// Responsible-play features in index.html: the break lock screen and the time-check reminder.
// The code runs straight from index.html, cut out by the comment markers below, so keep those comments in place.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
function between(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  assert.ok(start >= 0, `index.html is missing the marker ${JSON.stringify(startMarker)}`);
  const end = html.indexOf(endMarker, start);
  assert.ok(end > start, `index.html is missing the marker ${JSON.stringify(endMarker)}`);
  return html.slice(start, end);
}
const breakLockSource = between("    // Break lock:", "  </script>");
const timeCheckSource = between("      // Time check:", '      const reminder = document.querySelector("#session-reminder");');

const minute = 60_000;
const now = Date.UTC(2026, 9, 31, 18, 0);
const breakFor = ms => ({ "courtside.break.v1": JSON.stringify({ until: now + ms, startedAt: now }) });

function fakeElement(tag) {
  const parts = {};
  return {
    tagName: tag.toUpperCase(),
    id: "",
    className: "",
    type: "",
    textContent: "",
    innerHTML: "",
    disabled: false,
    children: [],
    listeners: {},
    get firstChild() { return this.children[0] || null; },
    appendChild(child) { this.children.push(child); return child; },
    insertBefore(child, before) {
      const index = this.children.indexOf(before);
      if (index < 0) this.children.push(child);
      else this.children.splice(index, 0, child);
      return child;
    },
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); },
    querySelector(selector) { return (parts[selector] ||= fakeElement("div")); }
  };
}

function runBreakLock({ stored = {}, search = "", user = "" } = {}) {
  const log = [];
  const clock = { now };
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
  const classes = new Set();
  const root = { classList: { add: name => classes.add(name) }, dataset: {} };
  const body = fakeElement("body");
  body.appendChild = child => { log.push("append"); body.children.push(child); return child; };
  const intervals = [];
  const documentListeners = {};
  const context = {
    Date: FakeDate,
    URLSearchParams,
    localStorage: { getItem: key => (Object.hasOwn(stored, key) ? stored[key] : null) },
    location: {
      search,
      reload() { log.push("reload"); },
      replace(url) { log.push(`replace ${url}`); }
    },
    document: {
      title: "WiselyBet | Market Board",
      documentElement: root,
      body,
      createElement: tag => fakeElement(tag),
      addEventListener(type, listener) { (documentListeners[type] ||= []).push(listener); }
    },
    setInterval(callback, ms) { intervals.push({ callback, ms }); return intervals.length; },
    clearInterval(id) { log.push(`clear ${id}`); },
    fetch(url, options) { log.push(`fetch ${options?.method || "GET"} ${url}`); return Promise.resolve({ ok: true }); },
    stop() { log.push("stop"); }
  };
  context.window = context;
  if (user) context.wiselyUser = user;
  vm.runInNewContext(breakLockSource, context);
  return { log, classes, root, clock, intervals, documentListeners, document: context.document, lock: body.children[0] || null };
}

test("no break, a finished break or an unreadable value leaves the page alone", () => {
  const values = [undefined, JSON.stringify({ until: now - 1 }), JSON.stringify({ until: now }), "{oops", "null", JSON.stringify({ until: "soon" })];
  for (const value of values) {
    const run = runBreakLock({ stored: value === undefined ? {} : { "courtside.break.v1": value } });
    assert.deepEqual(run.log, [], String(value));
    assert.equal(run.classes.size, 0);
    assert.equal(run.lock, null);
  }
});

test("an active break stops the page before showing the lock screen", () => {
  const run = runBreakLock({ stored: breakFor(90 * minute) });
  assert.deepEqual(run.log, ["stop", "append"], "loading stops first, so the lock's logo is not cancelled");
  assert.ok(run.classes.has("on-break"));
  assert.equal(run.lock.id, "break-lock");
  assert.equal(run.lock.tagName, "MAIN");
  assert.match(run.lock.querySelector(".break-text").textContent,
    /^You paused WiselyBet on this device until .+\. Phone alerts are paused too\. The break can't be ended early\.$/);
  assert.equal(run.lock.querySelector(".break-left").textContent, "1 hr 30 min left");
  assert.equal(run.lock.querySelector(".break-actions").children.length, 0, "guests have no sign-out button");
  assert.ok(run.lock.innerHTML.includes('href="tel:18004262537"'));
  assert.ok(run.lock.innerHTML.includes('href="/responsible-gaming"'));
  assert.equal(run.document.title, "Taking a break | WiselyBet");
  assert.equal(run.root.dataset.theme, undefined);
});

test("signed-in users get the all-devices wording, their theme and a working sign-out button", async () => {
  const run = runBreakLock({ stored: { ...breakFor(2 * 60 * minute), "courtside.settings.v1": JSON.stringify({ theme: "light" }) }, user: "sam" });
  assert.match(run.lock.querySelector(".break-text").textContent, /^You paused WiselyBet on all your devices until /);
  assert.equal(run.root.dataset.theme, "light");
  const [signOut, ...others] = run.lock.querySelector(".break-actions").children;
  assert.equal(others.length, 0);
  assert.equal(signOut.textContent, "Sign out");
  assert.equal(signOut.className, "break-secondary");
  signOut.listeners.click[0]();
  assert.equal(signOut.disabled, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(run.log.slice(-2), ["fetch POST /api/auth/logout", "replace /login"]);
});

test("inside the embedded tracker the frame only stops loading", () => {
  const run = runBreakLock({ stored: breakFor(30 * minute), search: "?embed=1" });
  assert.deepEqual(run.log, ["stop"]);
  assert.ok(run.classes.has("on-break"));
  assert.ok(run.classes.has("embed"));
  assert.equal(run.lock, null);
});

test("the countdown reads naturally", () => {
  const cases = [
    [30_000, "Less than a minute left"],
    [45 * minute, "45 min left"],
    [60 * minute, "1 hr left"],
    [61 * minute, "1 hr 1 min left"],
    [24 * 60 * minute, "1 day left"],
    [(2 * 24 + 3) * 60 * minute, "2 days 3 hr left"],
    [7 * 24 * 60 * minute, "7 days left"]
  ];
  for (const [ms, text] of cases) {
    assert.equal(runBreakLock({ stored: breakFor(ms) }).lock.querySelector(".break-left").textContent, text, `${ms} ms`);
  }
});

test("when the break ends the lock offers to reopen the app, once", () => {
  const run = runBreakLock({ stored: breakFor(20 * minute) });
  assert.equal(run.intervals.length, 1);
  assert.equal(run.intervals[0].ms, 15_000);
  run.clock.now = now + 10 * minute;
  run.intervals[0].callback();
  assert.equal(run.lock.querySelector(".break-left").textContent, "10 min left");

  run.clock.now = now + 20 * minute;
  run.documentListeners.visibilitychange[0]();
  assert.equal(run.lock.querySelector(".break-left").textContent, "Your break is over");
  assert.ok(run.log.includes("clear 1"));
  run.intervals[0].callback();
  const actions = run.lock.querySelector(".break-actions").children;
  assert.equal(actions.length, 1, "the button is added only once");
  assert.equal(actions[0].textContent, "Open WiselyBet");
  assert.equal(actions[0].className, "break-primary");
  actions[0].listeners.click[0]();
  assert.equal(run.log.at(-1), "reload");
});

const { sessionTick, playedFor } = vm.runInNewContext(`${timeCheckSource}\n({ sessionTick, playedFor });`);

test("time check: a fresh or unreadable state starts a new session", () => {
  for (const state of [null, {}, { start: "x", last: now }, { start: now - minute, last: Number.NaN }]) {
    const result = sessionTick(state, now, 60);
    assert.deepEqual({ ...result.state }, { start: now, last: now, shownAt: 0 }, JSON.stringify(state));
    assert.equal(result.due, false);
  }
});

test("time check: becomes due once the chosen time has passed", () => {
  const playing = { start: now - 59 * minute, last: now - minute, shownAt: 0 };
  assert.equal(sessionTick(playing, now, 60).due, false);
  const result = sessionTick({ ...playing, start: now - 60 * minute }, now, 60);
  assert.equal(result.due, true);
  assert.deepEqual({ ...result.state }, { start: now - 60 * minute, last: now, shownAt: 0 });
  assert.equal(sessionTick({ ...playing, start: now - 31 * minute }, now, 30).due, true);
  assert.equal(sessionTick({ ...playing, start: now - 600 * minute }, now, 0).due, false, "0 turns the reminder off");
});

test("time check: after a reminder the next one waits a full interval", () => {
  const start = now - 100 * minute;
  assert.equal(sessionTick({ start, last: now - minute, shownAt: now - 40 * minute }, now, 60).due, false);
  assert.equal(sessionTick({ start, last: now - minute, shownAt: now - 60 * minute }, now, 60).due, true);
  assert.equal(sessionTick({ start, last: now - minute, shownAt: "junk" }, now, 60).state.shownAt, 0);
});

test("time check: 30 minutes away or a clock moved back starts over", () => {
  const away = sessionTick({ start: now - 120 * minute, last: now - 30 * minute, shownAt: 0 }, now, 60);
  assert.deepEqual({ ...away.state }, { start: now, last: now, shownAt: 0 });
  assert.equal(away.due, false);
  const stillHere = sessionTick({ start: now - 120 * minute, last: now - 29 * minute, shownAt: 0 }, now, 60);
  assert.equal(stillHere.state.start, now - 120 * minute);
  assert.equal(sessionTick({ start: now + minute, last: now, shownAt: 0 }, now, 60).state.start, now);
});

test("time check: the time played reads naturally", () => {
  assert.equal(playedFor(0), "1 min");
  assert.equal(playedFor(90_000), "2 min");
  assert.equal(playedFor(59 * minute), "59 min");
  assert.equal(playedFor(60 * minute), "1 hr");
  assert.equal(playedFor(61 * minute), "1 hr 1 min");
  assert.equal(playedFor(125 * minute), "2 hr 5 min");
});
