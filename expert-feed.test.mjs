import test from "node:test";
import assert from "node:assert/strict";
import { boardGames, matchGame, readArticle, verifiedPicks } from "./collect-expert-picks.mjs";
import { createFeedReader, freshnessMs, publicFeed } from "./expert-feed.mjs";

const now = Date.parse("2026-11-26T20:00:00Z"), start = now + 2 * 3_600_000;
const iso = n => new Date(n).toISOString();
const source = "https://www.thelines.com/nfl/picks/chiefs-vs-bills-parlay/";
const fixture = {
  date: iso(start), name: "Chiefs at Bills", status: { type: { state: "pre", name: "STATUS_SCHEDULED" } },
  competitions: [{ timeValid: true, competitors: [{ team: { name: "Chiefs" } }, { team: { name: "Bills" } }] }]
};
const games = boardGames({ events: [fixture] }, now);
const markup = `<script type="application/ld+json">${JSON.stringify({
  "@graph": [{ "@type": "Article", datePublished: iso(now), author: { name: "Example Analyst" } }]
})}</script><main><h1>Chiefs vs. Bills</h1><h3>Same-game parlay (+600)</h3>
<p>Two picks on one ticket</p><ul><li>Bills -2.5</li><li>Under 45.5 points</li></ul>
<h3>Single props</h3><ul><li>Not a parlay leg</li></ul></main>`;
const groups = readArticle(markup, source, games, now);
const ticket = { group: 0, legs: [0, 1], odds: "+600" };
const picks = verifiedPicks(groups, { tickets: [ticket] }, now);

test("matches one confirmed future fixture and excludes live, unknown-time, stale and unrelated articles", () => {
  assert.equal(games.length, 1);
  assert.equal(matchGame("Bears vs. Bills", games), null);
  assert.equal(matchGame("Chiefs vs. Bills", [...games, ...games]), null);
  for (const event of [{ ...fixture, date: iso(now) }, { ...fixture, status: { type: { state: "in" } } },
    { ...fixture, competitions: [{ ...fixture.competitions[0], timeValid: false }] }]) {
    assert.deepEqual(boardGames({ events: [event] }, now), []);
  }
  assert.deepEqual(readArticle(markup.replace(iso(now), "2025-11-26T20:00:00Z"), source, games, now), []);
  assert.deepEqual(readArticle(markup, "https://another.example/article", games, now), []);
});

test("model can select only the complete sourced ticket, never generate a leg or price", () => {
  assert.equal(picks.length, 1);
  assert.deepEqual(picks[0], { event: fixture.name, startTime: iso(start), analyst: "Example Analyst",
    publishedAt: iso(now), sourceUrl: source, legs: ["Bills -2.5", "Under 45.5 points"], odds: "+600" });
  const proposed = [{ ...ticket, legs: [0, 0] }, { ...ticket, legs: [1] }, { ...ticket, group: 7 },
    { ...ticket, legs: [0, "invented leg"] }, { ...ticket, odds: "+900" }, ticket];
  const allowed = verifiedPicks(groups, { tickets: proposed }, now);
  assert.equal(allowed.length, 1);
  assert.equal(allowed[0].odds, null);
  assert.deepEqual(verifiedPicks(groups, { tickets: [ticket] }, start), []);
});

test("SportsGambler retains market labels, attribution and missing price and rejects a rescheduled game", () => {
  const url = "https://www.sportsgambler.com/betting-tips/basketball/example-2026-11-26/";
  const html = `<header>By <a href="/writers/example/">Example Writer</a></header><h1>Chiefs vs Bills</h1>
    <script type="application/ld+json">${JSON.stringify({ "@type": "NewsArticle", datePublished: iso(now), mainEntity: { startDate: iso(start) } })}</script>
    <div class="betbuilder"><h3>Same Game Parlay Pick</h3><div class="bb_list_item"><span>Total</span><span>Under 145</span></div>
    <div class="bb_list_item"><span>Spread</span><span>Bills -5</span></div></div>`;
  const items = readArticle(html, url, games, now);
  assert.deepEqual(items[0].rows, ["Total: Under 145", "Spread: Bills -5"]);
  assert.equal(items[0].analyst, "Example Writer");
  assert.equal(verifiedPicks(items, { tickets: [ticket] }, now)[0].odds, null);
  assert.deepEqual(readArticle(html.replace(iso(start), iso(start + 10_000)), url, games, now), []);
});

test("HTTP reader shares loads, rechecks expiry on cache hits, and never treats a failed or missing feed as fresh", async () => {
  let clock = now, calls = 0, status = 200;
  const snapshot = { checkedAt: iso(now), picks };
  const read = createFeedReader(async () => {
    calls++;
    return { ok: status === 200, status, json: async () => snapshot };
  }, () => clock);
  const [a, b] = await Promise.all([read(), read()]);
  assert.equal(calls, 1); assert.deepEqual(a, b); assert.equal(a.picks.length, 1);
  clock = start - 30_000; status = 503;
  assert.equal((await read()).status, "cached");
  clock = start; assert.deepEqual((await read()).picks, []);
  clock = now + freshnessMs;
  assert.equal((await read()).status, "stale");
  clock += 60_001; status = 404;
  assert.equal((await read()).status, "pending");
  assert.throws(() => publicFeed({ picks }, now), /Invalid/);
  assert.deepEqual(publicFeed({ ...snapshot, picks: [{ ...picks[0], sourceUrl: "javascript:alert(1)" }] }, now).picks, []);
});

test("expert screen uses the complete ticket price, excludes unpriced and long tickets, and leaves the author's legs intact", () => {
  const tickets = ["+100", "-150", "+101", "+600", null, "-150"].map((odds, i) => ({
    ...picks[0], odds, legs: i === 5 ? ["A", "B", "C", "D"] : picks[0].legs
  }));
  const all = publicFeed({ checkedAt: iso(now), picks: tickets }, now).picks;
  assert.deepEqual(all.filter(p => p.smart).map(p => [p.odds, p.implied]), [["+100", .5], ["-150", .6]]);
  assert.equal(all[4].implied, null);
  assert.deepEqual(all.map(p => p.legs), tickets.map(p => p.legs));
});
