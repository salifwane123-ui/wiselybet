const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { runInNewContext } = require("node:vm");

const html = readFileSync(join(__dirname, "index.html"), "utf8");
function slice(start, end) {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Couldn't find the code starting at ${JSON.stringify(start)}`);
  return html.slice(from, to);
}
const code = [
  slice("    const baseballPitcherStats = new Set(", "    function sportEmoji(tracker) {"),
  slice("    // Over and Under picks share one stored threshold", "    const trackerSnapshots = new Map();"),
  slice("    function chooseBookLine(", "    const bookPropsCache"),
  slice("    // A parlay wins only if every leg hits", "    // Applause:"),
  slice("    function replacementFactor(snapshot) {", "    // Always-on performance read"),
  slice("    // Over keys keep their original shape", "    function syncTrackButtons"),
  slice("    function paceModel(tracker) {", "    function baseballRead(")
].join("\n");
const trackerSnapshots = new Map();
const page = runInNewContext(`${code}
({ trackerSide, isUnderPick, pickGoal, pickScore, pickOutcome, chooseBookLine, parlayStatus, trackerKey, underProjection, underChance, underRead });`, {
  trackerSnapshots,
  trackerStats: { PTS: { label: "Points", short: "PTS" }, REB: { label: "Rebounds", short: "REB" } },
  isFootballSport: sport => sport === "americanfootball_nfl" || sport === "americanfootball_ncaaf"
});
// Objects made inside the vm have their own prototypes; compare plain copies.
const plain = value => JSON.parse(JSON.stringify(value));

const over = { key: "over", name: "Test Player", sport: "basketball_nba", stat: "PTS", target: 25 };
const under = { ...over, key: "under", side: "under" };
const live = (extra = {}) => ({ state: "in", current: 12, found: true, minutes: 20, remaining: 20, fouls: 2, injury: null, replacements: [], ...extra });

test("picks saved before Unders existed stay Overs", () => {
  assert.equal(page.trackerSide({ target: 25 }), "over");
  assert.equal(page.trackerSide({ target: 25, side: "sideways" }), "over");
  assert.equal(page.isUnderPick(under), true);
  assert.equal(page.trackerKey("Test Player", "e1", "PTS"), JSON.stringify(["e1", "Test Player", "PTS"]));
  assert.equal(page.trackerKey("Test Player", "e1", "PTS", "over"), page.trackerKey("Test Player", "e1", "PTS"));
  assert.equal(page.trackerKey("Test Player", "e1", "PTS", "under"), JSON.stringify(["e1", "Test Player", "PTS", "under"]));
});

test("an Over wins at the target and loses when the game ends short", () => {
  assert.equal(page.pickOutcome(over, live({ current: 25 })), "won");
  assert.equal(page.pickOutcome(over, live({ current: 24 })), "live");
  assert.equal(page.pickOutcome(over, live({ current: 24, state: "post" })), "lost");
  assert.equal(page.pickOutcome(over, live({ current: 10, fouls: 6 })), "lost");
  assert.equal(page.pickOutcome(over, { state: "post", current: 0, found: false }), "lost");
});

test("an Under loses at the target, wins below it and is void if he didn't play", () => {
  assert.equal(page.pickOutcome(under, live({ current: 25 })), "lost");
  assert.equal(page.pickOutcome(under, live({ current: 24 })), "live");
  assert.equal(page.pickOutcome(under, { state: "pre", current: 0 }), "live");
  assert.equal(page.pickOutcome(under, live({ current: 24, state: "post" })), "won");
  assert.equal(page.pickOutcome(under, live({ current: 12, fouls: 6 })), "won");
  assert.equal(page.pickOutcome(under, { state: "post", current: 0, found: false }), "void");
  assert.equal(page.pickOutcome(under, { state: "post", current: 25, found: true }), "lost");
});

test("goals and scores read as Over or Under", () => {
  assert.equal(page.pickGoal(over), "25+");
  assert.equal(page.pickGoal(under), "Under 24.5");
  assert.equal(page.pickGoal(under, 30), "Under 29.5");
  assert.equal(page.pickScore(over, 26), "26/25 PTS");
  assert.equal(page.pickScore(under, 21), "21 PTS (Under 24.5)");
});

test("book lines move to the easier side for each pick", () => {
  const offers = points => points.map(([point, price]) => ({ point, price, direct: false }));
  const pick = (list, side) => {
    const choice = page.chooseBookLine(offers(list), 25, side);
    return [choice.offer?.point ?? null, choice.kind];
  };
  assert.deepEqual(pick([[23.5, 1.8], [24.5, 1.9], [25.5, 2.1]], "over"), [24.5, "exact"]);
  assert.deepEqual(pick([[23.5, 1.8], [24.5, 1.9], [25.5, 2.1]], "under"), [24.5, "exact"]);
  assert.deepEqual(pick([[23.5, 1.8], [25.5, 2.1]], "over"), [23.5, "lower"]);
  assert.deepEqual(pick([[23.5, 1.8], [25.5, 2.1]], "under"), [25.5, "higher"]);
  assert.deepEqual(pick([[23.5, 1.8]], "under"), [23.5, "lower"]);
  assert.deepEqual(pick([[23.5, 2.4]], "under"), [23.5, "remove"]);
  assert.deepEqual(pick([[25.5, 1.8]], "over"), [25.5, "higher"]);
});

test("parlays drop void Under legs like sportsbooks do", () => {
  const legs = [
    { ...over, key: "a", target: 20 },
    { ...under, key: "b" },
    { ...under, key: "c", target: 10 }
  ];
  trackerSnapshots.clear();
  trackerSnapshots.set("a", { state: "post", current: 22, found: true });
  trackerSnapshots.set("b", { state: "post", current: 0, found: false });
  trackerSnapshots.set("c", { state: "post", current: 4, found: true });
  assert.deepEqual(plain(page.parlayStatus(legs)), { tone: "hype", label: "Won 🎉", hits: 2, total: 2 });
  assert.deepEqual(plain(page.parlayStatus([legs[1]])), { tone: "idle", label: "Void", hits: 0, total: 0 });
  trackerSnapshots.set("c", { state: "in", current: 10, found: true });
  assert.equal(page.parlayStatus(legs).label, "Lost ❌");
  trackerSnapshots.set("c", { state: "in", current: 4, found: true });
  assert.deepEqual(plain(page.parlayStatus(legs)), { tone: "idle", label: "Live", hits: 1, total: 2 });
  trackerSnapshots.clear();
});

test("the Under chance follows the score, the clock and his availability", () => {
  assert.equal(page.underChance(under, live({ current: 25 })), 0);
  assert.equal(page.underChance(under, live({ current: 20, fouls: 6 })), 1);
  assert.equal(page.underChance(under, live({ current: 20, injury: { status: "Out" } })), 1);
  assert.ok(page.underChance(under, live({ remaining: 30, minutes: 12 })) < page.underChance(under, live({ remaining: 10, minutes: 28 })));
  assert.ok(page.underChance(under, live({ current: 20 })) < page.underChance(under, live({ current: 10 })));
  const base = page.underProjection(under, live());
  assert.ok(base > 0);
  assert.ok(Math.abs(page.underProjection(under, live({ fouls: 5 })) - base * 0.5) < 1e-9);
  assert.ok(Math.abs(page.underProjection(under, live({ injury: { status: "Questionable" } })) - base * 0.8) < 1e-9);
  assert.ok(Math.abs(page.underProjection(under, live({ replacements: [1, 2, 3] })) - base * 0.8) < 1e-9);
});

test("the live Under read only suggests cashing out late", () => {
  const hotLate = page.underRead(under, live({ current: 23, minutes: 30, remaining: 6 }));
  assert.equal(hotLate.short, "Consider cashing out");
  assert.equal(hotLate.level, "far");
  assert.equal(page.underRead(under, live({ current: 18, minutes: 14, remaining: 30 })).short, "Running hot — still early");
  assert.equal(page.underRead(under, live({ current: 2, minutes: 30, remaining: 3 })).short, "Cruising under");
  const fouledOut = page.underRead(under, live({ current: 20, fouls: 6 }));
  assert.equal(fouledOut.short, "Cruising under");
  assert.match(fouledOut.text, /Working for the Under: 6 fouls/);
});

test("a live Under on a player who hasn't checked in warns about the void", () => {
  const benched = page.underRead(under, live({ current: 0, minutes: 0, found: false }));
  assert.equal(benched.short, "Hasn't played yet");
  assert.equal(benched.level, "close");
  assert.match(benched.text, /void the Under/);
  assert.doesNotMatch(benched.text, /estimated chance/);
});

test("phone alerts cover Over and Under picks", async () => {
  const { trackerAlerts } = await import(pathToFileURL(join(__dirname, "push.mjs")).href);
  const game = (state, stats, extra = {}) => ({
    state,
    injuries: [],
    teams: [{ players: stats ? [{ name: "Test Player", onCourt: true, stats: Object.entries(stats).map(([label, value]) => ({ label, value: String(value) })) }] : [] }],
    ...extra
  });
  const before = (current, extra = {}) => ({ current, fouls: 1, onCourt: true, injuryKey: "", hit: false, close: false, done: false, ...extra });
  const titles = result => result.messages.map(item => item.title);

  let result = trackerAlerts(over, before(20), game("in", { PTS: 25, PF: 1 }));
  assert.deepEqual(result.messages, [{ title: "🎉 Target hit", body: "Test Player reached 25 points!", tag: "hit-over" }]);
  assert.equal(result.next.hit, true);
  assert.equal("locked" in result.next, false);
  result = trackerAlerts(over, before(21), game("in", { PTS: 23, PF: 1 }));
  assert.deepEqual(result.messages, [{ title: "🔥 Close to target", body: "Test Player has 23/25 points.", tag: "close-over" }]);
  result = trackerAlerts(over, before(20), game("post", { PTS: 22, PF: 1 }));
  assert.deepEqual(result.messages, [{ title: "❌ Final — pick missed", body: "Test Player finished with 22 points (target 25).", tag: "final-over" }]);
  assert.equal(result.next.done, true);

  result = trackerAlerts(under, before(23), game("in", { PTS: 26, PF: 1 }));
  assert.deepEqual(result.messages, [{ title: "❌ Under busted", body: "Test Player went over 24.5 points (26).", tag: "hit-under" }]);
  result = trackerAlerts(under, before(21), game("in", { PTS: 23, PF: 1 }));
  assert.deepEqual(result.messages, [{ title: "⚠️ Close to the line", body: "Test Player has 23 points — 1 to spare on Under 24.5.", tag: "close-under" }]);

  result = trackerAlerts(under, before(10, { fouls: 5, locked: false }), game("in", { PTS: 10, PF: 6 }));
  assert.deepEqual(titles(result), ["Foul", "✅ Under locked"]);
  assert.equal(result.next.locked, true);
  assert.deepEqual(titles(trackerAlerts(under, result.next, game("in", { PTS: 10, PF: 6 }))), []);

  result = trackerAlerts(under, before(20), game("post", { PTS: 22, PF: 1 }));
  assert.deepEqual(result.messages, [{ title: "✅ Final — pick hit", body: "Test Player finished with 22 points (Under 24.5).", tag: "final-under" }]);
  assert.deepEqual(titles(trackerAlerts(under, before(26, { hit: true }), game("post", { PTS: 27, PF: 2 }))), ["❌ Final — pick missed"]);
  assert.deepEqual(titles(trackerAlerts(under, before(0), game("post", null))), ["↩️ Final — no action"]);

  result = trackerAlerts(under, before(23), game("in", { PTS: 26, PF: 2 }), kind => kind !== "score");
  assert.deepEqual(titles(result), ["Foul"]);
  assert.equal(result.next.hit, true);
});
