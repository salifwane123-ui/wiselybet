const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");

const html = readFileSync(join(__dirname, "index.html"), "utf8");
function slice(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Couldn't find the code starting at ${JSON.stringify(start)}`);
  return html.slice(from, to);
}
const code = [
  slice("    // Sportsbooks only hand out a betslip link per pick.", "    function sportsbookTitle(key) {"),
  slice("    function safeLink(value) {", "    function fillStateOptions(select) {")
].join("\n");
const settings = { parlayState: "" };
const page = runInNewContext(`${code}
({ combineBetslipLinks, resolveBookLink });`, { URL, settings });

const betrivers = outcome => `https://{state}.betrivers.com/?page=sportsbook#event/1028744840?coupon={pickType}|${outcome}|{wagerAmount}`;

test("BetRivers links open a single pick at the user's state site", () => {
  assert.equal(page.resolveBookLink(betrivers("4396572427"), "PA"),
    "https://pa.betrivers.com/?page=sportsbook#event/1028744840?coupon=single|4396572427|");
  assert.equal(page.resolveBookLink(betrivers("4396572427").replace("{pickType}", "%7BpickType%7D"), "PA"),
    "https://pa.betrivers.com/?page=sportsbook#event/1028744840?coupon=single|4396572427|");
  // Without a state there's no site to open.
  assert.equal(page.resolveBookLink(betrivers("4396572427"), ""), "");
  settings.parlayState = "NJ";
  assert.equal(page.resolveBookLink(betrivers("4396572427")), "https://nj.betrivers.com/?page=sportsbook#event/1028744840?coupon=single|4396572427|");
  settings.parlayState = "";
});

test("BetRivers picks combine into one coupon", () => {
  const links = ["4396572427", "4396572499"].map(outcome => page.resolveBookLink(betrivers(outcome), "PA"));
  assert.equal(page.combineBetslipLinks("betrivers", links),
    "https://pa.betrivers.com/?page=sportsbook#event/1028744840?coupon=combination|4396572427,4396572499|");
});

test("links with an unknown placeholder or another protocol are dropped", () => {
  assert.equal(page.resolveBookLink("https://sportsbook.example.com/?bet={betId}"), "");
  assert.equal(page.resolveBookLink("http://sportsbook.example.com/"), "");
  assert.equal(page.resolveBookLink("https://sportsbook.draftkings.com/event/1?outcomes=0QA1"), "https://sportsbook.draftkings.com/event/1?outcomes=0QA1");
});
