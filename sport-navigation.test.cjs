const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");
const soccerSupport = require("./soccer.js");
const html = readFileSync("index.html", "utf8");
const source = html.slice(html.indexOf("    function renderSportNavigation("), html.indexOf("    function normalizeTeamName("));

function setup({ hover = true, phone = false, selected = "basketball_nba", leagues = true } = {}) {
  class Node {
    constructor(tag, className = "", text = "") {
      Object.assign(this, { tag, className, textContent: text, children: [], dataset: {}, style: {}, attributes: {}, listeners: {} });
    }
    append(...nodes) { nodes.forEach(node => { node.parent = this; this.children.push(node); }); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    get classList() { return { contains: name => this.className.split(" ").includes(name) }; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    focus() { document.activeElement = this; }
    getBoundingClientRect() { return this.className === "soccer-league-panel" ? { width: 260, height: 350 } : { top: phone ? 780 : 350, right: phone ? 370 : 200 }; }
    querySelectorAll(selector) {
      const match = node => selector === ".sport-nav-button:not(.soccer-nav-toggle)"
        ? node.className.includes("sport-nav-button") && !node.className.includes("soccer-nav-toggle")
        : selector === '[aria-current="true"]' ? node.attributes["aria-current"] === "true"
        : selector === "button" ? node.tag === "button" : node.className.split(" ").includes(selector.slice(1));
      return this.children.flatMap(child => [...(match(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  const body = new Node("body");
  const document = { body, activeElement: null, listeners: {},
    getElementById(id) { return body.children.find(node => node.id === id) || null; },
    addEventListener(name, listener) { this.listeners[name] = listener; } };
  const timers = new Map();
  const window = {
    innerWidth: phone ? 390 : 1200, innerHeight: phone ? 844 : 900, listeners: {},
    matchMedia(query) { return { matches: query.includes("max-width") ? phone : hover }; },
    clearTimeout(id) { timers.delete(id); }, setTimeout(callback) { timers.set(callback, callback); return callback; },
    addEventListener(name, listener) { this.listeners[name] = listener; }
  };
  const nav = new Node("nav");
  const select = { value: selected, changes: 0, dispatchEvent() { this.changes++; context.updateSportNavigation(); } };
  const context = { document, window, soccerSupport, isSoccer: soccerSupport.isSoccer, sportNavigationElement: nav,
    sportSelect: select, Event: class {}, element: (...args) => new Node(...args) };
  runInNewContext(source, context);
  const sports = [{ key: "basketball_nba", title: "NBA" }, ...(leagues ? Object.entries(soccerSupport.leagues).map(([key, league]) => ({ key, title: league.title })) : [])];
  context.renderSportNavigation(sports);
  return { nav, document, window, select, context, timers,
    group: nav.querySelector(".soccer-nav-group"), toggle: nav.querySelector(".soccer-nav-toggle"), panel: document.getElementById("soccer-league-panel") };
}

test("seven soccer leagues share one Soccer button while NBA remains separate", () => {
  const app = setup();
  assert.equal(app.nav.children.length, 2);
  assert.equal(app.panel.querySelectorAll("button").length, 7);
  assert.equal(app.panel.hidden, true);
  assert.equal(app.toggle.attributes["aria-controls"], "soccer-league-panel");
  const choices = app.panel.querySelectorAll("button");
  assert.equal(choices[0].dataset.code, "EPL");
  assert.equal(choices[0].dataset.region, "England");
  assert.equal(choices[0].attributes["aria-label"], "Premier League, England");
  assert.equal(choices[0].querySelector(".soccer-choice-check").attributes["aria-hidden"], "true");
});

test("click opens, league choice selects and closes, and a second click dismisses", () => {
  const app = setup();
  app.toggle.listeners.click();
  assert.equal(app.panel.hidden, false);
  const choice = app.panel.querySelectorAll("button")[1];
  choice.listeners.click();
  assert.equal(app.select.value, "soccer_spain_la_liga");
  assert.equal(app.select.changes, 1);
  assert.equal(app.panel.hidden, true);
  assert.equal(app.toggle.attributes["aria-current"], "true");
  assert.equal(choice.attributes["aria-current"], "true");
  app.toggle.listeners.click();
  app.toggle.listeners.click();
  assert.equal(app.panel.hidden, true);
});

test("fine-pointer hover opens and leaving closes, while touch does not hover-open", () => {
  const app = setup();
  app.group.listeners.pointerenter();
  assert.equal(app.panel.hidden, false);
  app.group.listeners.pointerleave();
  for (const callback of app.timers.values()) callback();
  assert.equal(app.panel.hidden, true);
  const phone = setup({ hover: false, phone: true });
  phone.group.listeners.pointerenter();
  assert.equal(phone.panel.hidden, true);
  phone.toggle.listeners.click();
  assert.equal(phone.panel.hidden, false);
  assert.ok(Number.parseFloat(phone.panel.style.top) + 350 < 780);
  assert.ok(Number.parseFloat(phone.panel.style.left) + 260 <= 390);
});

test("Escape, outside click and focus departure close; ArrowDown focuses a league", () => {
  const app = setup();
  app.group.listeners.keydown({ key: "ArrowDown", target: app.toggle, preventDefault() {} });
  assert.equal(app.document.activeElement, app.panel.querySelector("button"));
  app.group.listeners.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(app.panel.hidden, true);
  assert.equal(app.document.activeElement, app.toggle);
  app.toggle.listeners.click();
  app.document.listeners.click({ target: {} });
  assert.equal(app.panel.hidden, true);
  app.toggle.listeners.click();
  app.group.listeners.focusout({ relatedTarget: {} });
  assert.equal(app.panel.hidden, true);
});

test("dropdown sport changes update the Soccer selection and preserve the full selector", () => {
  const app = setup({ selected: "soccer_usa_mls" });
  assert.match(app.toggle.attributes["aria-label"], /MLS selected/);
  app.select.value = "basketball_nba";
  app.context.updateSportNavigation();
  assert.equal(app.toggle.attributes["aria-current"], "false");
  assert.equal(setup({ leagues: false }).group, null);
});

test("league menu is outside the sidebar, preserves keyboard and hover handling, and cleans up on rerender", () => {
  const app = setup();
  assert.equal(app.panel.parent, app.document.body);
  assert.equal(app.group.contains(app.panel), false);
  app.toggle.listeners.click();
  const choice = app.panel.querySelector("button");
  app.group.listeners.focusout({ relatedTarget: choice });
  app.document.listeners.click({ target: choice });
  app.document.listeners.scroll({ target: app.panel });
  assert.equal(app.panel.hidden, false);
  app.panel.listeners.keydown({ key: "Escape", preventDefault() {} });
  assert.equal(app.panel.hidden, true);
  assert.equal(app.document.activeElement, app.toggle);
  app.document.activeElement = null;
  app.group.listeners.pointerenter();
  app.group.listeners.pointerleave();
  app.panel.listeners.pointerenter();
  assert.equal(app.timers.size, 0);
  app.panel.listeners.pointerleave();
  for (const callback of app.timers.values()) callback();
  assert.equal(app.panel.hidden, true);
  app.context.renderSportNavigation([{ key: "basketball_nba", title: "NBA" }]);
  assert.equal(app.document.getElementById("soccer-league-panel"), null);
});

test("sport button colors override generic hover styles and retain readable contrast", () => {
  assert.ok(html.includes('#soccer-league-panel .soccer-league-choice:hover:not(:disabled)'));
  assert.ok(html.includes('#sport-navigation .sport-nav-button[aria-current="true"]:hover:not(:disabled)'));
  const luminance = hex => {
    const channels = hex.match(/[\da-f]{2}/gi).map(value => {
      const channel = Number.parseInt(value, 16) / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  for (const [text, background] of [
    ["edf2e8", "263420"], ["e1f2c9", "2b3d20"],
    ["26331f", "edf3e5"], ["29420f", "e3edcf"],
    ["edf2e8", "171e18"], ["b3bfb0", "171e18"], ["b3bfb0", "2b3d20"],
    ["59674e", "ffffff"], ["59674e", "e3edcf"]
  ]) {
    const values = [luminance(text), luminance(background)].sort((a, b) => b - a);
    assert.ok((values[0] + .05) / (values[1] + .05) >= 4.5);
  }
  assert.match(html, /background: #171e18; color: #edf2e8; border-color: #40503b/);
});
