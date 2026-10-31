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
  slice("    function normalizeTeamName(", "    function teamNamesMatch("),
  slice("    // True once a pick's stat reached its target", "    function burstBellSparks("),
  slice("    const baseballPitcherStats = new Set(", "    function sportEmoji(tracker) {"),
  slice("    // Over and Under picks share one stored threshold", "    const trackerSnapshots = new Map();"),
  slice("    function createParlay(", "    function renameParlay("),
  slice("    // Default names (\"Parlay 2\") follow", "    // Asks what to do with the picks before a parlay is deleted."),
  slice("    function restoreRequestedTargets(", "    function setParlaySportsbook("),
  slice("    function chooseBookLine(", "    const bookPropsCache"),
  slice("    const suggestionId = suggest =>", "    // Unanswered suggestions quietly expire"),
  slice("    // A parlay wins only if every leg hits", "    // Applause:"),
  slice("    function replacementFactor(snapshot) {", "    // Always-on performance read"),
  slice("    // Over keys keep their original shape", "    function syncTrackButtons"),
  slice("    // Adds a pick to a parlay, or as a single pick", "    const historyKey = "),
  slice("    const historyKey = ", "    function historyRecord()"),
  slice("    function paceModel(tracker) {", "    function baseballRead("),
  slice("    // Copies of a pick in several parlays pop for the same play", "    // Sparks and confetti flying out"),
  slice("    // Opening a pick or the whole parlay at the sportsbook also tracks it", "    // A short note that the picks are in the tracker, with Undo."),
  slice("    function normalizeName(", "    function normalizeSignalName("),
  slice("    // Players the user took out of the best parlay", "    function bestParlayLegText("),
  slice("    function bestParlayLegText(", "    // The book and state lists are declared")
].join("\n");
const trackerSnapshots = new Map();
const storage = new Map();
let selectedParlayLegCount = 2;
let clock = Date.parse("2025-01-15T00:00:00Z");
class FakeDate extends Date {
  static now() { return clock; }
}
const noop = () => {};
const timers = [];
const sounds = [];
// The page's own state; functions that reassign `trackers` or `parlays` update these properties.
const context = {
  soccerSupport: require("./soccer.js"),
  isSoccer: require("./soccer.js").isSoccer,
  trackerSnapshots,
  trackers: [],
  parlays: [],
  parlayBookState: new Map(),
  parlayLegTarget: () => selectedParlayLegCount,
  currentEvents: [{ id: "e1", home_team: "Boston Celtics", away_team: "New York Knicks", commence_time: "2025-01-15T00:30:00Z" }],
  localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
  Date: FakeDate,
  window: { setTimeout: callback => timers.push(callback) },
  saveTrackers: noop,
  saveParlays: noop,
  syncTrackButtons: noop,
  setTrackerPanelOpen: noop,
  renderTrackers: noop,
  renderHistory: noop,
  forgetSuggestions: noop,
  queueSound: sound => sounds.push(sound.name),
  playCashSound: function cash() {},
  playScoreSound: function score() {},
  pollTrackers: async () => {},
  trackerStats: { PTS: { label: "Points", short: "PTS" }, REB: { label: "Rebounds", short: "REB" } },
  isFootballSport: sport => sport === "americanfootball_nfl" || sport === "americanfootball_ncaaf",
  marketToTrackerStatBySport: { basketball_nba: { player_points: "PTS", player_rebounds: "REB", player_assists: "AST" } },
  sportsbookTitle: key => ({ draftkings: "DraftKings", fanduel: "FanDuel" })[key] || key,
  propMarketPhrase: () => "points",
  element: (tag, className, text = "") => ({
    tag, className, textContent: text, children: [],
    append(...children) { this.children.push(...children); }
  }),
  setParlaySportsbook: (parlay, book) => { parlay.sportsbook = book; }
};
const page = runInNewContext(`${code}
({ trackerSide, isUnderPick, pickGoal, pickScore, pickOutcome, chooseBookLine, parlayStatus, trackerKey, underProjection, underChance, underRead,
   pickIdentity, pickSlot, pickCopyIn, addTracker, deleteParlay, recordHistory, readHistory, goalReachedNames, firstAnnouncement,
   playOnce, bestParlayPicks, trackBestParlayPicks, parlayWinOdds, bestParlayLegsFor, bestParlayPlayerKey, rememberBestParlayRemoved,
   forgetBestParlayRemoved, syncBestParlayRemoved, trackerClock, suggestionsSettled, bookSuggestionPending, removalSuggestionPending,
   disableParlaySuggestions, bestParlayLegText, createLiveNow });`, context);
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

test("each pick shows its game clock, the final or when the game starts", () => {
  const now = Date.parse("2025-01-15T00:00:00Z");
  const at = minutes => ({ ...over, date: new Date(now + minutes * 60_000).toISOString() });
  const time = minutes => new Date(now + minutes * 60_000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const clockFor = (tracker, snapshot) => plain(page.trackerClock(tracker, snapshot, now));
  assert.deepEqual(clockFor(at(-30), { state: "in", periodLabel: "1:29 - 2nd" }), { tone: "live", text: "1:29 - 2nd" });
  assert.deepEqual(clockFor(at(-30), { state: "in", periodLabel: "" }), { tone: "live", text: "Live" });
  assert.deepEqual(clockFor(at(-180), { state: "post", periodLabel: "Final/OT" }), { tone: "final", text: "Final/OT" });
  assert.deepEqual(clockFor(at(-180), { state: "post", periodLabel: "" }), { tone: "final", text: "Final" });
  assert.deepEqual(clockFor(at(60), { state: "pre", periodLabel: "Postponed" }), { tone: "alert", text: "Postponed" });
  assert.deepEqual(clockFor({ ...over }, { state: "" }), { tone: "pre", text: "Start time TBD" });
  assert.deepEqual(clockFor(at(-2), { state: "pre", periodLabel: "" }), { tone: "pre", text: `Starting soon · ${time(-2)}` });
  const soon = clockFor(at(90), { state: "pre" });
  assert.equal(soon.tone, "soon");
  assert.ok(soon.text.endsWith(`${time(90)} · in 1h 30m`), soon.text);
  assert.ok(clockFor(at(45), {}).text.endsWith(`${time(45)} · in 45m`));
  const later = clockFor(at(3 * 24 * 60), { state: "pre" });
  assert.equal(later.tone, "pre");
  assert.ok(later.text.endsWith(` · ${time(3 * 24 * 60)}`) && !later.text.includes(" in "), later.text);
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

test("a hit parlay pays out at each counted leg's price at its sportsbook", () => {
  const legs = [
    { ...over, key: "a", target: 20, odds: { book: "draftkings", target: 20, price: 1.9 } },
    // The line accepted for the book is what's tracked now, not the one opened earlier.
    { ...over, key: "b", target: 8, bookLine: { book: "draftkings", point: 7.5, price: 1.8, kind: "lower" }, odds: { book: "draftkings", target: 9, price: 2.1 } },
    { ...under, key: "c", target: 10 }
  ];
  trackerSnapshots.clear();
  trackerSnapshots.set("a", { state: "post", current: 22, found: true });
  trackerSnapshots.set("b", { state: "post", current: 9, found: true });
  // He didn't play, so the Under is void and drops out of the payout like it does at the book.
  trackerSnapshots.set("c", { state: "post", current: 0, found: false });
  const parlay = { id: "p1", sportsbook: "draftkings" };
  assert.ok(Math.abs(page.parlayWinOdds(parlay, legs) - 1.9 * 1.8) < 1e-9);
  // Every counted leg needs a price at the parlay's own sportsbook for the line it tracks.
  assert.equal(page.parlayWinOdds({ id: "p1" }, legs), null);
  assert.equal(page.parlayWinOdds({ ...parlay, sportsbook: "fanduel" }, legs), null);
  assert.equal(page.parlayWinOdds(parlay, [{ ...legs[0], target: 21 }]), null);
  assert.equal(page.parlayWinOdds(parlay, [legs[0], { ...over, key: "d", target: 5 }]), null);
  assert.equal(page.parlayWinOdds(parlay, [legs[2]]), null);
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

const track = (name, stat, target, parlay, side) => page.addTracker(name, "basketball_nba", "e1", stat, target, parlay, side);
const twoParlays = () => {
  context.parlays = [{ id: "p1", name: "Parlay 1" }, { id: "p2", name: "Parlay 2" }];
  context.trackers = [];
  trackerSnapshots.clear();
};

test("the same pick can be in several parlays and once as a single pick", () => {
  twoParlays();
  const plainKey = page.trackerKey("Test Player", "e1", "PTS");
  const first = track("Test Player", "PTS", 25, "p1");
  const second = track("Test Player", "PTS", 25, "p2");
  const single = track("Test Player", "PTS", 22, "");
  assert.deepEqual(plain(context.trackers.map(item => [item.parlay, item.target])), [["p1", 25], ["p2", 25], ["", 22]]);
  assert.equal(new Set(context.trackers.map(item => item.key)).size, 3);
  assert.ok(context.trackers.every(item => page.pickIdentity(item) === plainKey && item.key !== plainKey));
  assert.deepEqual(plain(JSON.parse(first.key).slice(0, 3)), JSON.parse(plainKey));
  assert.equal(page.pickCopyIn(plainKey, "p2"), second);
  assert.equal(page.pickCopyIn(plainKey, ""), single);

  // A parlay that already has the pick only gets the new line; the other copies keep theirs.
  assert.equal(track("Test Player", "PTS", 28, "p1"), first);
  assert.equal(context.trackers.length, 3);
  assert.deepEqual(plain(context.trackers.map(item => item.target)), [28, 25, 22]);

  // The Under on the same stat is a different pick.
  const underPick = track("Test Player", "PTS", 25, "p1", "under");
  assert.equal(context.trackers.length, 4);
  assert.equal(page.pickIdentity(underPick), page.trackerKey("Test Player", "e1", "PTS", "under"));
  assert.equal(page.addTracker("Test Player", "basketball_nba", "unknown-game", "PTS", 25, "p1"), null);
});

test("a new line starts the pick over under a fresh key", () => {
  twoParlays();
  const pick = track("Test Player", "PTS", 25, "p1");
  const firstKey = pick.key;
  trackerSnapshots.set(firstKey, { current: 26, hitNotified: true, recorded: true });
  assert.equal(track("Test Player", "PTS", 25, "p1").key, firstKey);
  assert.equal(trackerSnapshots.has(firstKey), true);
  assert.equal(track("Test Player", "PTS", 30, "p1"), pick);
  assert.notEqual(pick.key, firstKey);
  assert.equal(trackerSnapshots.has(firstKey), false);

  // Picks saved with the plain key keep it, and a removed pick's key isn't handed to the next copy.
  const plainKey = page.trackerKey("Test Player", "e1", "PTS");
  context.trackers = [{ ...plain(pick), key: plainKey, parlay: "p2" }];
  assert.equal(track("Test Player", "PTS", 30, "p2").key, plainKey);
  const removedKey = pick.key;
  assert.notEqual(track("Test Player", "PTS", 30, "p1").key, removedKey);
  assert.equal(new Set(context.trackers.map(item => item.key)).size, 2);
});

test("a pick whose parlay is gone counts as a single pick", () => {
  twoParlays();
  const leftover = track("Test Player", "PTS", 25, "p1");
  leftover.parlay = "deleted-parlay";
  assert.equal(page.pickSlot("deleted-parlay"), "");
  assert.equal(track("Test Player", "PTS", 27, ""), leftover);
  assert.equal(leftover.parlay, "");
  assert.equal(leftover.target, 27);
  assert.equal(context.trackers.length, 1);
});

test("opening a parlay at the sportsbook turns its suggestions off for good", () => {
  twoParlays();
  const leg = track("Test Player", "PTS", 25, "p1");
  const otherParlay = track("Test Player", "PTS", 25, "p2");
  const single = track("Test Player", "PTS", 22, "");
  const lineChange = { suggest: { book: "draftkings", target: 24, point: 23.5, price: 1.9, kind: "lower" } };
  const removal = { suggestRemove: true };
  assert.equal(page.bookSuggestionPending(leg, lineChange), true);
  assert.equal(page.removalSuggestionPending(leg, removal, "draftkings"), true);

  page.disableParlaySuggestions("p1");
  assert.equal(context.parlays[0].suggestionsOff, true);
  assert.equal(page.suggestionsSettled(leg), true);
  assert.equal(page.bookSuggestionPending(leg, lineChange), false);
  assert.equal(page.removalSuggestionPending(leg, removal, "draftkings"), false);
  // A pick added to that parlay later gets none either; other parlays and single picks are unaffected.
  const later = track("Other Player", "REB", 8, "p1");
  assert.equal(page.bookSuggestionPending(later, lineChange), false);
  assert.equal(page.bookSuggestionPending(otherParlay, lineChange), true);
  assert.equal(page.suggestionsSettled(single), false);
  page.disableParlaySuggestions("missing-parlay");
  assert.equal(context.parlays[1].suggestionsOff, undefined);
});

test("deleting a parlay keeps its picks as singles without doubling one", () => {
  twoParlays();
  track("Test Player", "PTS", 22, "");
  const leg = track("Test Player", "PTS", 25, "p1");
  track("Other Player", "REB", 8, "p1");
  const otherParlay = track("Test Player", "PTS", 25, "p2");
  trackerSnapshots.set(leg.key, { current: 3 });
  page.deleteParlay(context.parlays[0]);
  assert.deepEqual(plain(context.trackers.map(item => [item.name, item.parlay, item.target])),
    [["Test Player", "", 22], ["Other Player", "", 8], ["Test Player", "p2", 25]]);
  assert.equal(trackerSnapshots.has(leg.key), false);
  assert.equal(otherParlay.parlay, "p2");

  page.deleteParlay(context.parlays[0], { removePicks: true });
  assert.deepEqual(plain(context.trackers.map(item => item.name)), ["Test Player", "Other Player"]);
});

test("a player's alerts stay on while one of his picks in the game is open", () => {
  twoParlays();
  const low = track("Test Player", "PTS", 20, "p1");
  const high = track("Test Player", "PTS", 30, "p2");
  trackerSnapshots.set(low.key, { current: 22 });
  trackerSnapshots.set(high.key, { current: 22 });
  assert.deepEqual(plain(page.goalReachedNames()), []);
  trackerSnapshots.set(high.key, { current: 31 });
  assert.deepEqual(plain(page.goalReachedNames()), ["testplayer"]);
  trackerSnapshots.clear();
});

test("copies of a pick announce each alert once", () => {
  assert.equal(page.firstAnnouncement("alert|foul|Test Player committed a foul (3 PF)."), true);
  assert.equal(page.firstAnnouncement("alert|foul|Test Player committed a foul (3 PF)."), false);
  assert.equal(page.firstAnnouncement("alert|foul|Test Player committed a foul (4 PF)."), true);
  clock += 6000;
  assert.equal(page.firstAnnouncement("alert|foul|Test Player committed a foul (3 PF)."), true);
});

test("a pick in several parlays is recorded once in the history", () => {
  storage.clear();
  const pick = { name: "Test Player", sport: "basketball_nba", eventId: "e1", stat: "PTS", target: 25, home: "Boston Celtics", away: "New York Knicks" };
  page.recordHistory({ ...pick, key: "a", parlay: "p1" }, 27, "win");
  page.recordHistory({ ...pick, key: "b", parlay: "p2" }, 27, "win");
  assert.equal(page.readHistory().length, 1);
  page.recordHistory({ ...pick, key: "c", target: 30 }, 27, "loss");
  page.recordHistory({ ...pick, key: "d", side: "under" }, 27, "loss");
  page.recordHistory({ ...pick, key: "e", eventId: "e2" }, 27, "win");
  const history = page.readHistory();
  assert.equal(history.length, 4);
  assert.deepEqual(plain(history.map(item => [item.eventId, item.target, item.side || "over", item.result])),
    [["e2", 25, "over", "win"], ["e1", 25, "under", "loss"], ["e1", 30, "over", "loss"], ["e1", 25, "over", "win"]]);
});

test("results saved before history kept the game id still count once", () => {
  const pick = { name: "Test Player", sport: "basketball_nba", eventId: "e1", stat: "PTS", target: 25, home: "Boston Celtics", away: "New York Knicks", date: "2025-01-15T00:30:00Z" };
  const saved = at => JSON.stringify([{ name: "Test Player", stat: "PTS", target: 25, final: 27, result: "win", game: "New York Knicks @ Boston Celtics", at }]);
  storage.set("courtside.history.v1", saved("2025-01-15T02:45:00Z"));
  page.recordHistory(pick, 27, "win");
  assert.equal(page.readHistory().length, 1);
  // The same teams met on another day.
  storage.set("courtside.history.v1", saved("2025-01-10T02:45:00Z"));
  page.recordHistory(pick, 27, "win");
  assert.equal(page.readHistory().length, 2);
});

test("a play sounds once when several copies of the pick pop for it", () => {
  timers.length = 0;
  sounds.length = 0;
  page.playOnce("pop|e1|Test Player|PTS|22", false);
  page.playOnce("pop|e1|Test Player|PTS|22", true);
  page.playOnce("pop|e1|Test Player|PTS|22", false);
  assert.equal(timers.length, 1);
  timers.splice(0).forEach(run => run());
  assert.deepEqual(sounds, ["cash"]);
  // The next poll seeing the same play stays quiet; a new play sounds again.
  page.playOnce("pop|e1|Test Player|PTS|22", false);
  assert.equal(timers.length, 0);
  page.playOnce("pop|e1|Test Player|PTS|24", false);
  timers.splice(0).forEach(run => run());
  assert.deepEqual(sounds, ["cash", "score"]);
});

test("phone alerts from copies of a pick are sent once", async () => {
  const { uniqueMessages } = await import(pathToFileURL(join(__dirname, "push.mjs")).href);
  const foul = { title: "Foul", body: "Test Player committed a foul (3 PF).", tag: "foul-a" };
  const lowHit = { title: "🎉 Target hit", body: "Test Player reached 20 points!", tag: "hit-a" };
  const highHit = { title: "🎉 Target hit", body: "Test Player reached 30 points!", tag: "hit-b" };
  assert.deepEqual(uniqueMessages([foul, { ...foul, tag: "foul-b" }, lowHit, { ...lowHit, tag: "hit-c" }, highHit]), [foul, lowHit, highHit]);
});

test("the server forgets a pick's alert state once its game window has passed", async () => {
  const { forgetFinishedPicks } = await import(pathToFileURL(join(__dirname, "push.mjs")).href);
  const now = Date.parse("2025-01-15T12:00:00Z");
  const userState = new Map([
    ["t:finished", { hit: true, until: now - 1 }],
    ["t:live", { hit: false, until: now + 60_000 }],
    ["f:followed", { found: true }]
  ]);
  forgetFinishedPicks(userState, now);
  assert.deepEqual([...userState.keys()], ["t:live", "f:followed"]);
});

const bestLeg = (player, market, line) =>
  ({ player, market, line, eventId: "e1", home: "Boston Celtics", away: "New York Knicks", start: "2025-01-15T00:30:00Z" });
const brunson = bestLeg("Jalen Brunson", "player_points", 24.5);
const tatum = bestLeg("Jayson Tatum", "player_rebounds", 8.5);
const hart = bestLeg("Josh Hart", "player_assists", 6.5);
const draftkings = { sport: "basketball_nba", book: "draftkings" };
const openAtBook = (legs, whole, data = draftkings) => page.trackBestParlayPicks(legs, data, whole);
const ticketLegs = parlay => plain(context.trackers.filter(item => item.parlay === parlay.id).map(item => [item.name, item.stat, item.target]));
const clockTime = () => new Date(clock).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const noParlays = () => {
  context.parlays = [];
  context.trackers = [];
  trackerSnapshots.clear();
};

test("opening the betslip tracks the parlay once, set to that sportsbook", () => {
  noParlays();
  const first = openAtBook([brunson, tatum], true);
  assert.equal(first.created, true);
  assert.equal(first.added.length, 2);
  assert.deepEqual(plain(first.parlay), { id: first.parlay.id, name: "Best parlay · DraftKings", sportsbook: "draftkings", ticketAt: clock });
  assert.deepEqual(ticketLegs(first.parlay), [["Jalen Brunson", "PTS", 25], ["Jayson Tatum", "REB", 9]]);

  // Opening it again changes nothing, even after a line moved.
  const again = openAtBook([{ ...brunson, line: 25.5 }, tatum], true);
  assert.equal(again.parlay, first.parlay);
  assert.equal(again.created, false);
  assert.equal(again.added.length, 0);
  assert.equal(context.parlays.length, 1);
  assert.deepEqual(ticketLegs(first.parlay), [["Jalen Brunson", "PTS", 25], ["Jayson Tatum", "REB", 9]]);

  // Legs the tracker can't follow are skipped, so a parlay of only those isn't tracked.
  assert.equal(openAtBook([bestLeg("Jalen Brunson", "player_threes", 2.5)], true), null);
  assert.equal(openAtBook([brunson], true, { sport: "soccer_epl", book: "draftkings" }), null);
  assert.equal(openAtBook([brunson], true, { sport: "basketball_nba", book: "" }), null);
  assert.equal(context.parlays.length, 1);
});

test("legs opened one by one build one ticket, and the betslip completes it", () => {
  noParlays();
  const ticket = openAtBook([brunson], false).parlay;
  clock += 10 * 60_000;
  const joined = openAtBook([tatum], false);
  assert.equal(joined.parlay, ticket);
  assert.equal(joined.created, false);
  assert.equal(joined.added.length, 1);
  assert.equal(ticket.ticketAt, clock);
  assert.equal(openAtBook([tatum], false).added.length, 0);

  clock += 10 * 60_000;
  const whole = openAtBook([brunson, tatum, hart], true);
  assert.equal(whole.parlay, ticket);
  assert.deepEqual(plain(whole.added), [context.trackers[2].key]);
  assert.deepEqual(ticketLegs(ticket).map(([name]) => name), ["Jalen Brunson", "Jayson Tatum", "Josh Hart"]);
  assert.equal(context.parlays.length, 1);
});

test("another betslip, a later leg or another sportsbook starts a new ticket", () => {
  noParlays();
  const first = openAtBook([brunson, tatum], true).parlay;
  // The open ticket has a leg this betslip leaves out, so it's another bet.
  const second = openAtBook([tatum, hart], true).parlay;
  assert.notEqual(second, first);
  assert.equal(second.name, `Best parlay · DraftKings · ${clockTime()}`);
  const third = openAtBook([brunson, hart], true).parlay;
  assert.equal(third.name, "Best parlay · DraftKings #2");

  // Within half an hour a single leg joins the newest ticket.
  clock += 29 * 60_000;
  assert.equal(openAtBook([tatum], false).parlay, third);
  assert.equal(ticketLegs(third).length, 3);

  // After that, a leg already in a parlay at this book stays put, and a new leg starts a ticket.
  clock += 30 * 60_000;
  const kept = openAtBook([hart], false);
  assert.equal(kept.parlay, third);
  assert.equal(kept.added.length, 0);
  const fresh = openAtBook([bestLeg("Mikal Bridges", "player_points", 15.5)], false);
  assert.equal(fresh.created, true);
  assert.equal(fresh.parlay.name, `Best parlay · DraftKings · ${clockTime()}`);

  const fanduel = openAtBook([brunson, tatum], true, { sport: "basketball_nba", book: "fanduel" });
  assert.equal(fanduel.created, true);
  assert.deepEqual([fanduel.parlay.name, fanduel.parlay.sportsbook], ["Best parlay · FanDuel", "fanduel"]);
  assert.equal(context.parlays.length, 5);
  assert.equal(page.bestParlayPicks([brunson, hart], "basketball_nba").map(pick => pick.stat).join(","), "PTS,AST");
});

test("picks opened at the sportsbook keep their price there for the payout", () => {
  noParlays();
  const { parlay } = openAtBook([{ ...brunson, price: 1.87 }, tatum], true);
  const [priced, unpriced] = context.trackers;
  assert.deepEqual(plain(priced.odds), { book: "draftkings", target: 25, price: 1.87 });
  assert.equal(unpriced.odds, undefined);
  assert.equal(page.parlayWinOdds(parlay, [priced]), 1.87);
  // A leg without a price means no payout figure, rather than a wrong one.
  assert.equal(page.parlayWinOdds(parlay, [priced, unpriced]), null);
});

test("best-parlay Under picks keep their side, price and distinct tracker identity", () => {
  noParlays();
  const under = { ...brunson, side: "under", price: 1.91 };
  const picks = page.bestParlayPicks([brunson, under], "basketball_nba");
  assert.notEqual(picks[0].identity, picks[1].identity);
  const { parlay } = openAtBook([under, tatum], true);
  const tracked = context.trackers.find(tracker => tracker.name === brunson.player);
  assert.equal(tracked.side, "under");
  assert.equal(tracked.target, 25);
  assert.equal(tracked.odds.price, 1.91);
  assert.equal(openAtBook([under, tatum], true).parlay, parlay);
  assert.equal(context.trackers.length, 2);
  assert.equal(page.bestParlayLegText(under, "basketball_nba"), "Jalen Brunson Under 24.5 points");
  assert.equal(page.bestParlayLegText(brunson, "basketball_nba"), "Jalen Brunson Over 24.5 points");
  const now = page.createLiveNow({ current: 12, stat: "PTS", need: 13 }, under);
  assert.match(now.children[0].title, /must finish below 24.5/);
  assert.equal(now.children[1].textContent, "below 24.5");
});

test("a player taken out of the best parlay stays out for his game, and an alternate fills his spot", () => {
  const removedKey = "courtside.bpRemoved.v1";
  const hours = count => count * 60 * 60_000;
  const names = ({ legs, removed }) => plain([legs.map(leg => leg.player), removed.map(leg => leg.player)]);
  const pricedBrunson = { ...brunson, price: 1.3 };
  const pricedTatum = { ...tatum, price: 1.4 };
  const pricedHart = { ...hart, price: 1.5 };
  const data = { legs: [pricedTatum, pricedBrunson], alternates: [pricedHart] };
  assert.deepEqual(names(page.bestParlayLegsFor(data)), [["Jayson Tatum", "Jalen Brunson"], []]);
  selectedParlayLegCount = 1;
  assert.deepEqual(names(page.bestParlayLegsFor(data)), [["Jayson Tatum"], []]);
  selectedParlayLegCount = 2;
  assert.deepEqual(names(page.bestParlayLegsFor({ legs: [pricedBrunson] })), [["Jalen Brunson"], []]);

  // His game already started, so he stays out for 12 hours from now. Every market of his goes, in every tab.
  assert.ok(clock > Date.parse(brunson.start));
  page.rememberBestParlayRemoved(brunson);
  assert.equal(page.bestParlayPlayerKey(brunson), "e1|jalenbrunson");
  assert.deepEqual(JSON.parse(storage.get(removedKey)), { "e1|jalenbrunson": clock + hours(12) });
  assert.deepEqual(names(page.bestParlayLegsFor(data)), [["Jayson Tatum", "Josh Hart"], ["Jalen Brunson"]]);
  const assists = { ...pricedBrunson, market: "player_assists", line: 6.5 };
  assert.deepEqual(names(page.bestParlayLegsFor({ legs: [assists], alternates: [] })), [[], ["Jalen Brunson"]]);
  // The same name in another game is still in.
  assert.deepEqual(names(page.bestParlayLegsFor({ legs: [{ ...pricedBrunson, eventId: "e2" }] })), [["Jalen Brunson"], []]);

  // Before tip-off, the 12 hours count from the start.
  const later = { ...pricedHart, eventId: "e3", start: new Date(clock + hours(2)).toISOString() };
  page.rememberBestParlayRemoved(later);
  assert.equal(JSON.parse(storage.get(removedKey))["e3|joshhart"], clock + hours(14));

  // Another tab reads the same list; it's forgotten once the time is up.
  page.syncBestParlayRemoved();
  assert.deepEqual(names(page.bestParlayLegsFor(data)), [["Jayson Tatum", "Josh Hart"], ["Jalen Brunson"]]);
  clock += hours(13);
  page.syncBestParlayRemoved();
  assert.deepEqual(names(page.bestParlayLegsFor(data)), [["Jayson Tatum", "Jalen Brunson"], []]);
  assert.deepEqual(names(page.bestParlayLegsFor({ legs: [later] })), [[], ["Josh Hart"]]);

  // Restoring brings him back and returns how many came back.
  assert.equal(page.forgetBestParlayRemoved(["e3|joshhart", "e1|nobody"]), 1);
  assert.equal(page.forgetBestParlayRemoved(["e3|joshhart"]), 0);
  assert.deepEqual(names(page.bestParlayLegsFor({ legs: [later] })), [["Josh Hart"], []]);
  assert.deepEqual(JSON.parse(storage.get(removedKey)), {});
});
