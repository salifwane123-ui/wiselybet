const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");

const html = readFileSync(join(__dirname, "index.html"), "utf8");
const start = html.indexOf("    function findPriceDiscounts(");
const end = html.indexOf("    function renderPriceDeals(");
assert.ok(start > 0 && end > start, "findPriceDiscounts must be extractable from index.html");
const findPriceDiscounts = runInNewContext(`${html.slice(start, end)}\nfindPriceDiscounts;`);

const now = Date.parse("2026-03-01T18:00:00Z");
const later = new Date(now + 3_600_000).toISOString();

function book(title, home, away) {
  return {
    key: title.toLowerCase().replace(/\s+/g, ""),
    title,
    markets: [{ key: "h2h", outcomes: [{ name: "Home Team", price: home }, { name: "Away Team", price: away }] }]
  };
}

function game(id, generousHome, options = {}) {
  return {
    id,
    home_team: "Home Team",
    away_team: "Away Team",
    commence_time: options.commence ?? later,
    bookmakers: [
      book("Book A", 2, 1.85),
      book("Book B", 2, 1.85),
      book("Book C", 2, 1.85),
      book("Book D", generousHome, options.generousAway ?? 1.75)
    ]
  };
}

// The three matching books price the home side at 0.5 / (0.5 + 1 / 1.85) once their margin is removed.
const consensusHome = 0.5 / (0.5 + 1 / 1.85);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);

test("flags the book paying more than the no-vig consensus of the other books", () => {
  const deals = findPriceDiscounts([game("g1", 2.15)], now);
  assert.equal(deals.length, 1);
  const [deal] = deals;
  assert.equal(deal.eventId, "g1");
  assert.equal(deal.outcome, "Home Team");
  assert.equal(deal.book, "Book D");
  assert.equal(deal.price, 2.15);
  assert.equal(deal.typical, 2);
  assert.equal(deal.books, 4);
  assert.equal(deal.start, Date.parse(later));
  near(deal.probability, consensusHome);
  near(deal.edge, 2.15 * consensusHome - 1);
});

test("the generous book is left out of its own benchmark", () => {
  const [deal] = findPriceDiscounts([game("g1", 2.15)], now);
  const withBest = (3 * consensusHome + (1 / 2.15) / (1 / 2.15 + 1 / 1.75)) / 4;
  assert.notEqual(deal.probability, withBest);
  near(deal.probability, consensusHome);
});

test("games that already started or have no start time are skipped", () => {
  assert.equal(findPriceDiscounts([game("live", 2.15, { commence: new Date(now - 60_000).toISOString() })], now).length, 0);
  assert.equal(findPriceDiscounts([game("now", 2.15, { commence: new Date(now).toISOString() })], now).length, 0);
  assert.equal(findPriceDiscounts([game("unknown", 2.15, { commence: "not a date" })], now).length, 0);
});

test("needs at least three books quoting the outcome", () => {
  const event = game("g1", 2.15);
  event.bookmakers = [event.bookmakers[0], event.bookmakers[3]];
  assert.equal(findPriceDiscounts([event], now).length, 0);

  const oneSided = game("g2", 2.15);
  oneSided.bookmakers[1].markets[0].outcomes.pop();
  oneSided.bookmakers[2].markets[0].outcomes.pop();
  assert.equal(findPriceDiscounts([oneSided], now).length, 0, "books quoting a single outcome can't be de-vigged");
});

test("matching prices, prices below fair value and invalid prices are not discounts", () => {
  assert.equal(findPriceDiscounts([game("tie", 2, { generousAway: 1.85 })], now).length, 0);
  assert.equal(findPriceDiscounts([game("vig", 2.05)], now).length, 0, "beats the typical book but not the fair price");
  const broken = game("broken", 2.15);
  broken.bookmakers[3].markets[0].outcomes[0].price = "N/A";
  assert.equal(findPriceDiscounts([broken], now).length, 0);
});

test("longshots and suspiciously large gaps are ignored", () => {
  const longshot = {
    ...game("long", 0),
    bookmakers: [book("Book A", 15, 1.04), book("Book B", 15, 1.04), book("Book C", 15, 1.04), book("Book D", 17, 1.03)]
  };
  assert.equal(findPriceDiscounts([longshot], now).length, 0);
  assert.equal(findPriceDiscounts([game("stale", 2.8)], now).length, 0);
});

test("sorts by size of the discount and applies the limit", () => {
  const events = [game("small", 2.12), game("big", 2.2), game("medium", 2.15)];
  const ids = (limit) => Array.from(findPriceDiscounts(events, now, limit), deal => deal.eventId);
  assert.deepEqual(ids(), ["big", "medium", "small"]);
  assert.deepEqual(ids(2), ["big", "medium"]);
  assert.equal(findPriceDiscounts(null, now).length, 0);
});
