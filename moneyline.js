(function (root) {
  const soccer = typeof module !== "undefined" && module.exports ? require("./soccer.js") : root.soccerSupport;
  const isMoneyline = tracker => tracker?.stat === "ML";
  const teamName = (name, sport) => soccer.isSoccer(sport) ? soccer.teamName(name)
    : String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  function selection(name, event, sport) {
    if (soccer.isSoccer(sport) && /^draw$/i.test(name)) return "draw";
    for (const side of ["home", "away"]) {
      const team = event[`${side}_team`];
      if (team && teamName(name, sport) === teamName(team, sport)) return side;
    }
    return "";
  }
  function snapshot(tracker, game) {
    const result = { state: game.state, periodLabel: game.periodLabel || "", current: 0, stats: {},
      found: false, error: "", outcome: "live", scoreText: "Awaiting score", position: "Waiting" };
    const unavailable = error => ({ ...result, error });
    const teams = (game.teams || []);
    const home = teams.find(team => team.homeAway === "home");
    const away = teams.find(team => team.homeAway === "away");
    if (!home || !away || teamName(home.name, tracker.sport) !== teamName(tracker.home, tracker.sport) ||
        teamName(away.name, tracker.sport) !== teamName(tracker.away, tracker.sport)) {
      return unavailable("The match teams could not be verified. Waiting for the correct live feed.");
    }
    if (home.scoreVerified === false || away.scoreVerified === false) {
      return unavailable("Live team scores are not available yet.");
    }
    const score = team => typeof team.score === "number" || /^\d+$/.test(String(team.score ?? ""))
      ? Number(team.score) : NaN;
    const homeScore = score(home), awayScore = score(away);
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore) || homeScore < 0 || awayScore < 0) {
      return unavailable("Live team scores are not available yet.");
    }
    result.scoreText = `${tracker.away} ${awayScore} - ${homeScore} ${tracker.home}`;
    result.stats = { AWAY: awayScore, HOME: homeScore };
    if (!["home", "away", "draw"].includes(tracker.selection) ||
        (tracker.selection === "draw" && !soccer.isSoccer(tracker.sport))) {
      return unavailable("This moneyline selection is invalid. Remove it and track the pick again.");
    }
    if (soccer.isSoccer(tracker.sport) && (Number(game.period) > 2 || /extra.?time|penalt|shootout|AET/i.test(game.periodLabel || ""))) {
      return { ...result, error: "Extra time or penalties: the 90-minute moneyline result cannot be verified. Check your sportsbook." };
    }
    if (/cancel|postpon|suspend|abandon/i.test(`${game.status || ""} ${game.periodLabel || ""}`)) {
      return { ...result, error: "Match interrupted. Waiting for a verified result; check your sportsbook's void rules." };
    }
    result.found = true;
    const margin = tracker.selection === "home" ? homeScore - awayScore : awayScore - homeScore;
    result.position = tracker.selection === "draw" ? (homeScore === awayScore ? "Draw currently" : "Not level")
      : margin > 0 ? "Leading" : margin < 0 ? "Trailing" : "Tied";
    if (game.state === "post") {
      const winner = homeScore > awayScore ? "home" : awayScore > homeScore ? "away" : "";
      result.outcome = winner ? (tracker.selection === winner ? "won" : "lost")
        : soccer.isSoccer(tracker.sport) ? (tracker.selection === "draw" ? "won" : "lost") : "void";
      result.current = result.outcome === "won" ? 1 : 0;
    }
    return result;
  }
  const support = { isMoneyline, selection, snapshot };
  if (typeof module !== "undefined" && module.exports) module.exports = support;
  else root.moneylineSupport = support;
})(globalThis);
