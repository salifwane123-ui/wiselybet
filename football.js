(function (root) {
  const anytimeMarket = "player_anytime_td";
  function anytimeOutcome(outcome) {
    const name = String(outcome?.name || "").trim();
    const selection = name.toLowerCase();
    const player = String(outcome?.description || "").trim();
    if (!player || !["yes", "no", "over", "under"].includes(selection) ||
        !Number.isFinite(outcome.price) || outcome.price <= 1) return null;
    return { ...outcome, description: player, name: ["yes", "over"].includes(selection) ? "Over" : "Under", point: 0.5 };
  }
  function touchdowns(stats) {
    const number = label => {
      const value = Number(stats[label]);
      return stats[label] !== undefined && Number.isFinite(value) && value >= 0 ? value : 0;
    };
    // The defensive and interception groups can report the same return touchdown.
    const defensive = Math.max(number("defensive TD"), number("interceptions TD"), number("fumbles TD"));
    return number("rushing TD") + number("receiving TD") + number("kickReturns TD") + number("puntReturns TD") + defensive;
  }
  const api = { anytimeMarket, anytimeOutcome, touchdowns };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.footballSupport = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
