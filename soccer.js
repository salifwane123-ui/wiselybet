(function (root) {
  const leagues = {
    soccer_epl: { title: "Premier League", espn: "soccer/eng.1", props: true },
    soccer_spain_la_liga: { title: "La Liga", espn: "soccer/esp.1", props: true },
    soccer_uefa_champs_league: { title: "Champions League", espn: "soccer/uefa.champions", props: false },
    soccer_usa_mls: { title: "MLS", espn: "soccer/usa.1", props: true },
    soccer_italy_serie_a: { title: "Serie A", espn: "soccer/ita.1", props: true },
    soccer_germany_bundesliga: { title: "Bundesliga", espn: "soccer/ger.1", props: true },
    soccer_france_ligue_one: { title: "Ligue 1", espn: "soccer/fra.1", props: true }
  };
  const markets = [["player_shots", "Shots"], ["player_shots_on_target", "Shots on target"], ["player_assists", "Assists"]];
  const marketStats = { player_shots: "SH", player_shots_on_target: "SOT", player_assists: "A" };
  const statLabels = {
    totalGoals: "G", goalAssists: "A", totalShots: "SH", shotsOnTarget: "SOT",
    saves: "SAV", yellowCards: "YC", redCards: "RC", foulsCommitted: "FC",
    minutesPlayed: "MIN", appearances: "APP", subIns: "SUBIN", subOuts: "SUBOUT"
  };
  const isSoccer = sport => Object.hasOwn(leagues, sport);
  function teamName(name) {
    const normalized = String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/\b(fc|cf|afc|sc)\b/g, "").replace(/[^a-z0-9]/g, "");
    const aliases = {
      manutd: "manchesterunited", manunited: "manchesterunited", mancity: "manchestercity",
      tottenham: "tottenhamhotspur", wolves: "wolverhamptonwanderers",
      brighton: "brightonandhovealbion", brightonhovealbion: "brightonandhovealbion",
      psg: "parissaintgermain", parisstgermain: "parissaintgermain", inter: "internazionale",
      intermilan: "internazionale", acmilan: "milan", bayernmunich: "bayernmunchen",
      athleticbilbao: "athleticclub", nottmforest: "nottinghamforest"
    };
    return aliases[normalized] || normalized;
  }
  function clock(game) {
    const detail = String(game.periodLabel || game.status || "");
    if (game.state === "post") return { elapsed: 90, remaining: 0, label: detail || "Full time" };
    if (game.state !== "in") return { elapsed: 0, remaining: 90, label: detail || "Scheduled" };
    const text = String(game.clock || "").trim().replace(/['’]/g, "");
    let elapsed = null;
    if (/^\d+\+\d+$/.test(text)) elapsed = text.split("+").reduce((sum, part) => sum + Number(part), 0);
    else if (/^\d+:\d+(?:\.\d+)?$/.test(text)) {
      const [minutes, seconds] = text.split(":").map(Number);
      elapsed = minutes + seconds / 60;
    } else if (/^\d+(?:\.\d+)?$/.test(text)) elapsed = Number(text);
    if (/half.?time|^HT$/i.test(detail)) elapsed = 45;
    if (elapsed === null) {
      const minute = detail.match(/(\d+)(?:\+(\d+))?\s*['’]/);
      if (minute) elapsed = Number(minute[1]) + Number(minute[2] || 0);
    }
    return { elapsed, remaining: elapsed === null ? null : Math.max(0, 90 - elapsed),
      label: detail || (text ? `${text}'` : "Live") };
  }
  function playerStats(player) {
    return (player.stats || []).flatMap(stat => {
      const label = statLabels[stat.name];
      const value = stat.value ?? stat.displayValue;
      return label && value !== undefined && value !== null && value !== ""
        ? [{ label, value: String(value) }] : [];
    });
  }
  function alertKind(play) {
    const text = `${play.type || ""} ${play.text || ""}`;
    if (/disallow|overturn|cancel|no goal/i.test(text)) return "";
    if (play.scoring && /goal|penalty/i.test(text)) return "score";
    if (/yellow.?card|red.?card|foul/i.test(text)) return "foul";
    if (/substitution/i.test(text)) return "court";
    if (/injur/i.test(text)) return "injury";
    return "";
  }
  function players(roster, state) {
    return (roster?.roster || []).map(player => {
      const stats = playerStats(player);
      const value = label => Number(stats.find(stat => stat.label === label)?.value);
      // A published lineup is not proof that the player has appeared in the match.
      const appeared = value("APP") > 0 || value("MIN") > 0;
      const fieldStatusKnown = stats.some(stat => stat.label === "SUBOUT");
      return {
        id: String(player.athlete?.id || ""), name: player.athlete?.displayName || "",
        shortName: player.athlete?.shortName || "", jersey: player.jersey || "",
        headshot: player.athlete?.headshot?.href || "",
        position: player.athlete?.position?.abbreviation || "",
        starter: player.starter === true, starterConfirmed: typeof player.starter === "boolean",
        appeared, onCourt: state === "in" && appeared && fieldStatusKnown && value("SUBOUT") === 0 && value("RC") !== 1,
        stats
      };
    }).filter(player => player.name);
  }
  const support = { leagues, markets, marketStats, isSoccer, clock, players, teamName, alertKind };
  if (typeof module !== "undefined" && module.exports) module.exports = support;
  else root.soccerSupport = support;
})(globalThis);
