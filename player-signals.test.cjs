const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");

const html = readFileSync(join(__dirname, "index.html"), "utf8");
const server = readFileSync(join(__dirname, "server.mjs"), "utf8");
const helpers = html.slice(html.indexOf("    function normalizeSignalName("), html.indexOf("    const playerSignalPopover ="));
const { assessPlayerSignals, playerMarketSignal } = runInNewContext(`${helpers}\n({ assessPlayerSignals, playerMarketSignal });`, {
  normalizeName: value => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "")
});
const injuryParser = server.slice(server.indexOf("function playerInjuryReport("), server.indexOf("async function fetchPlayerInjuries("));
const playerInjuryReport = runInNewContext(`${injuryParser}\nplayerInjuryReport;`);
const now = Date.parse("2026-10-30T00:30:00Z");
const iso = offset => new Date(now + offset).toISOString();
const player = "Example Player";

function fixture() {
  return {
    player, sport: "basketball_nba", market: "player_points", now,
    event: {
      id: "example-event", commence_time: iso(-3_600_000),
      home_team: "Home Team", away_team: "Away Team",
      bookmakers: ["one", "two"].map(key => ({
        key, markets: [{
          key: "player_points", last_update: iso(-60_000),
          outcomes: [
            { description: player, name: "Over", point: 24.5, price: 1.7 },
            { description: player, name: "Under", point: 24.5, price: 2.2 }
          ]
        }]
      }))
    },
    context: {
      injuries: { source: "ESPN", sourceUpdatedAt: iso(0), checkedAt: iso(0), injuries: [] },
      game: {
        state: "in", period: 2, date: iso(-3_600_000), updatedAt: iso(0),
        teams: [{ players: [{
          name: player, starter: true, starterConfirmed: true,
          stats: [{ label: "PF", value: "1" }, { label: "MIN", value: "18" }]
        }] }]
      }
    }
  };
}
const athlete = input => input.context.game.teams[0].players[0];
const row = (result, label) => result.rows.find(item => item.label === label);

test("green means favorable available live signals, never a good-form or popularity claim", () => {
  const result = assessPlayerSignals(fixture());
  assert.equal(result.tone, "good");
  assert.equal(result.label, "Favorable live signals");
  assert.match(result.summary, /not a good-form rating/);
  for (const label of ["Recent form", "Public betting", "Minutes / replacements"]) {
    assert.match(row(result, label).text, /unavailable/i);
  }
  assert.match(row(result, "Personal fouls").text, /Historical and early-foul tendencies are unavailable/);
  assert.match(row(result, "Injury report").text, /not medical clearance/);
  assert.match(row(result, "Market lean").text, /not a bet count/);
});

test("any active injury risk takes precedence over favorable odds and role", () => {
  for (const status of ["Out", "Doubtful", "Questionable", "Day-To-Day", "Probable", "Suspended"]) {
    const input = fixture();
    input.context.injuries.injuries = [{ name: player, team: "Home Team", status, reportedAt: iso(-86_400_000) }];
    const result = assessPlayerSignals(input);
    assert.equal(result.tone, "warning", status);
    assert.equal(row(result, "Injury report").tone, "warning", status);
    assert.match(row(result, "Injury report").text, /not a forecast/);
  }
});

test("injuries are matched by player and event team, not a name fragment", () => {
  const input = fixture();
  input.context.injuries.injuries = [
    { name: player, team: "Unrelated Team", status: "Out" },
    { name: `${player} Jr`, team: "Home Team", status: "Out" }
  ];
  assert.equal(assessPlayerSignals(input).tone, "good");
  input.context.injuries.injuries.push({ name: "Exámple Player", team: "Home Team", status: "Out" });
  assert.equal(assessPlayerSignals(input).tone, "warning");
});

test("ambiguous player reports or box-score identities cannot earn green", () => {
  const input = fixture();
  const injury = { name: player, team: "Home Team", status: "Out" };
  input.context.injuries.injuries = [injury, { ...injury }];
  assert.equal(assessPlayerSignals(input).tone, "neutral");
  assert.match(row(assessPlayerSignals(input), "Injury report").text, /ambiguous/);
  input.context.injuries.injuries = [];
  input.context.game.teams.push({ players: [{ ...athlete(input) }] });
  assert.equal(assessPlayerSignals(input).tone, "neutral");
});

test("missing, stale, failed or malformed injury data is not a clean bill of health", () => {
  for (const injuries of [null, {}, { injuries: [] }, { injuries: {} },
    { injuries: [], sourceUpdatedAt: iso(-31 * 60_000) },
    { injuries: [], sourceUpdatedAt: iso(120_000) }]) {
    const input = fixture();
    input.context.injuries = injuries;
    assert.equal(assessPlayerSignals(input).tone, "neutral");
    assert.doesNotMatch(row(assessPlayerSignals(input), "Injury report").text, /No matching report/);
  }
  const input = fixture();
  input.context.injuries = null;
  input.context.injuryError = "ESPN is unavailable.";
  assert.match(row(assessPlayerSignals(input), "Injury report").text, /Unavailable: ESPN/);
});

test("foul-pressure thresholds are exact and apply to NBA and WNBA live games", () => {
  for (const sport of ["basketball_nba", "basketball_wnba"]) {
    for (const [period, fouls, warning] of [[1, 1, false], [1, 2, true], [2, 2, false], [2, 3, true], [3, 3, false], [3, 4, true], [5, 4, true]]) {
      const input = fixture();
      input.sport = sport;
      input.context.game.period = period;
      athlete(input).stats[0].value = String(fouls);
      const result = assessPlayerSignals(input);
      assert.equal(result.tone === "warning", warning, `${sport} period ${period}, ${fouls} fouls`);
    }
  }
});

test("missing or invalid foul counts are not interpreted as zero", () => {
  for (const value of [undefined, null, "", " ", "-", "unknown", "2.5", -1, true]) {
    const input = fixture();
    athlete(input).stats[0].value = value;
    const result = assessPlayerSignals(input);
    assert.equal(result.tone, "neutral", String(value));
    assert.match(row(result, "Personal fouls").text, /count unavailable/);
  }
});

test("no historical foul reputation is inferred from a finished game", () => {
  const input = fixture();
  input.context.game.state = "post";
  athlete(input).stats[0].value = "6";
  const result = assessPlayerSignals(input);
  assert.equal(result.tone, "neutral");
  assert.match(row(result, "Personal fouls").text, /finished game/);
  assert.match(row(result, "Personal fouls").text, /tendencies are unavailable/);
});

test("unconfirmed, pregame and stale lineups do not establish a starter", () => {
  for (const change of [
    input => { athlete(input).starterConfirmed = false; },
    input => { delete athlete(input).starterConfirmed; },
    input => { input.context.game.state = "pre"; },
    input => { input.context.game.updatedAt = iso(-121_000); },
    input => { input.context.game.date = iso(-19 * 3_600_000); },
    input => { input.context.game = null; }
  ]) {
    const input = fixture();
    change(input);
    assert.equal(assessPlayerSignals(input).tone, "neutral");
  }
  const input = fixture();
  athlete(input).starter = false;
  assert.equal(assessPlayerSignals(input).tone, "warning");
  assert.match(row(assessPlayerSignals(input), "Starting role").text, /Non-starter/);
});

test("basketball foul rules and green rating do not leak into other sports", () => {
  const input = fixture();
  input.sport = "icehockey_nhl";
  athlete(input).stats[0].value = "6";
  const result = assessPlayerSignals(input);
  assert.equal(result.tone, "neutral");
  assert.match(row(result, "Personal fouls").text, /does not apply/);
});

test("market signal pairs quotes from the same book and same line", () => {
  const input = fixture();
  input.event.bookmakers[0].markets[0].outcomes.pop();
  input.event.bookmakers[1].markets[0].outcomes.shift();
  assert.equal(playerMarketSignal(input.event, player, input.market, now), null);
  const other = fixture();
  for (const book of other.event.bookmakers) book.markets[0].outcomes[1].point = 25.5;
  assert.equal(playerMarketSignal(other.event, player, other.market, now), null);
});

test("market lean uses the most widely quoted line, not the most flattering one", () => {
  const input = fixture();
  input.event.bookmakers[0].markets[0].outcomes.push(
    { description: player, name: "Over", point: 5.5, price: 1.05 },
    { description: player, name: "Under", point: 5.5, price: 10 }
  );
  const signal = playerMarketSignal(input.event, player, input.market, now);
  assert.equal(signal.point, 24.5);
  assert.equal(signal.books, 2);
  assert.ok(signal.probability < .6);
});

test("green requires fresh 55% Over support from at least two distinct books", () => {
  for (const probability of [.5499, .55]) {
    const input = fixture();
    for (const book of input.event.bookmakers) {
      book.markets[0].outcomes[0].price = 1 / probability;
      book.markets[0].outcomes[1].price = 1 / (1 - probability);
    }
    assert.equal(assessPlayerSignals(input).tone, probability >= .55 ? "good" : "neutral");
  }
  for (const change of [
    input => { input.event.bookmakers.pop(); },
    input => { input.event.bookmakers[1].key = "one"; },
    input => { input.event.bookmakers[0].markets[0].last_update = iso(-301_000); },
    input => { delete input.event.bookmakers[0].markets[0].last_update; },
    input => { input.event.bookmakers[0].markets[0].outcomes[1].price = 1.1; }
  ]) {
    const input = fixture();
    change(input);
    assert.equal(assessPlayerSignals(input).tone, "neutral");
  }
});

test("Under favorites and turnovers do not masquerade as favorable player form", () => {
  const input = fixture();
  for (const book of input.event.bookmakers) {
    book.markets[0].outcomes[0].price = 2.2;
    book.markets[0].outcomes[1].price = 1.7;
  }
  assert.equal(assessPlayerSignals(input).tone, "neutral");
  assert.match(row(assessPlayerSignals(input), "Market lean").text, /Under 24.5/);
  const turnovers = fixture();
  turnovers.market = "player_turnovers";
  for (const book of turnovers.event.bookmakers) book.markets[0].key = turnovers.market;
  assert.equal(assessPlayerSignals(turnovers).tone, "neutral");
});

test("failed refresh withdraws green and aging data expires without another successful fetch", () => {
  const input = fixture();
  input.context.refreshError = "Network unavailable.";
  let result = assessPlayerSignals(input);
  assert.equal(result.tone, "neutral");
  assert.match(row(result, "Data refresh").text, /Network unavailable/);
  delete input.context.refreshError;
  input.now += 121_000;
  assert.equal(assessPlayerSignals(input).tone, "neutral");
});

test("injury endpoint retains every report with provenance instead of the news feed's 80-item cap", () => {
  const feed = {
    status: "success", timestamp: iso(0),
    injuries: [{
      displayName: "Home Team",
      injuries: Array.from({ length: 90 }, (_, index) => ({
        athlete: { displayName: `Player ${index}` }, status: "Out",
        shortComment: "Report detail", date: iso(-86_400_000)
      }))
    }]
  };
  const result = playerInjuryReport(feed);
  assert.equal(result.injuries.length, 90);
  assert.equal(result.source, "ESPN");
  assert.equal(result.sourceUpdatedAt, iso(0));
  assert.equal(result.injuries[89].team, "Home Team");
  assert.equal(result.injuries[89].reportedAt, iso(-86_400_000));
});

test("malformed injury feeds fail explicitly, never return a successful empty report", () => {
  for (const feed of [null, {}, { status: "error", injuries: [] },
    { status: "success", injuries: [{ displayName: "Home Team" }] },
    { status: "success", injuries: [{ displayName: "Home Team", injuries: [{ status: "Out" }] }] }
  ]) assert.throws(() => playerInjuryReport(feed), /injury report/);
  assert.equal(playerInjuryReport({ status: "success", timestamp: iso(0), injuries: [] }).injuries.length, 0);
});

const loader = html.slice(html.indexOf("    async function loadPlayerSignals("), html.indexOf("    const propSearchInput ="));
function loaderSetup() {
  const pending = {};
  const updates = [];
  const input = fixture();
  const context = {
    propSignalStatus: { textContent: "" }, playerPropsRequestId: 1,
    sportSelect: { value: input.sport },
    propEventSelect: { value: input.event.id },
    propMarketSelect: { value: input.market },
    fetchSignalInjuries: () => new Promise((resolve, reject) => { pending.injuries = { resolve, reject }; }),
    fetchLiveGame: () => new Promise((resolve, reject) => { pending.game = { resolve, reject }; }),
    updatePlayerSignalButton: (button, value) => updates.push(value)
  };
  const load = runInNewContext(`${loader}\nloadPlayerSignals;`, context);
  return { pending, updates, input, context, run: () => load([{ button: { isConnected: true }, input }], 1, input.sport, input.event, input.market) };
}

test("late player data cannot update a newly selected game or market", async () => {
  for (const change of [
    context => { context.playerPropsRequestId = 2; },
    context => { context.sportSelect.value = "icehockey_nhl"; },
    context => { context.propEventSelect.value = "other-event"; },
    context => { context.propMarketSelect.value = "player_rebounds"; }
  ]) {
    const app = loaderSetup();
    const request = app.run();
    change(app.context);
    app.pending.injuries.resolve(app.input.context.injuries);
    app.pending.game.resolve(app.input.context.game);
    await request;
    assert.equal(app.updates.length, 0);
  }
});

test("partial feed failure preserves valid signals and exposes the failed source", async () => {
  const app = loaderSetup();
  athlete(app.input).stats[0].value = "4";
  const request = app.run();
  app.pending.injuries.reject(new Error("Injury feed timeout."));
  app.pending.game.resolve(app.input.context.game);
  await request;
  assert.equal(app.updates.length, 1);
  assert.equal(app.updates[0].context.injuryError, "Injury feed timeout.");
  assert.equal(app.updates[0].context.game.state, "in");
  assert.equal(assessPlayerSignals(app.updates[0]).tone, "warning");
  assert.match(app.context.propSignalStatus.textContent, /could not be loaded/);
});

const positioner = html.slice(html.indexOf("    function positionPlayerSignal("), html.indexOf("    function closePlayerSignal("));
test("popover fits desktop and narrow screens without covering its hover/click trigger", () => {
  for (const [width, height, rect] of [
    [711, 816, { left: 280, top: 390, bottom: 426 }],
    [390, 844, { left: 300, top: 410, bottom: 454 }],
    [320, 568, { left: 4, top: 500, bottom: 544 }]
  ]) {
    const popup = {
      hidden: false, style: {}, scrollHeight: 760,
      getBoundingClientRect() {
        return { width: Math.min(370, width - 24), height: Math.min(760, Number.parseFloat(this.style.maxHeight)) };
      }
    };
    const position = runInNewContext(`${positioner}\npositionPlayerSignal;`, {
      activePlayerSignal: { getBoundingClientRect: () => rect },
      playerSignalPopover: popup, innerWidth: width, innerHeight: height,
      closePlayerSignal: () => assert.fail("An on-screen popover was closed")
    });
    position();
    const size = popup.getBoundingClientRect();
    const top = Number.parseFloat(popup.style.top);
    const left = Number.parseFloat(popup.style.left);
    assert.ok(left >= 12 && left + size.width <= width - 12);
    assert.ok(top >= 12 && top + size.height <= height - 12);
    assert.ok(top >= rect.bottom + 8 || top + size.height <= rect.top - 8);
  }
});
