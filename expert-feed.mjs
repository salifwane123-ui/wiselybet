const snapshotUrl = "https://raw.githubusercontent.com/salifwane123-ui/wiselybet/expert-feed/expert-picks.json";
export const freshnessMs = 9 * 60 * 60 * 1000;

export function publisher(link) {
  if (typeof link !== "string") return null;
  if (/^https:\/\/www\.thelines\.com\/(?:nfl|nba|ncaab|college-basketball)\/(?:picks|player-props)\/[a-z0-9-]+\/$/.test(link)) return "TheLines";
  if (/^https:\/\/www\.sportsgambler\.com\/betting-tips\/basketball\/[a-z0-9-]+-20\d\d-\d\d-\d\d\/$/.test(link)) return "SportsGambler";
  return null;
}

export function publicFeed(snapshot, now) {
  const checked = Date.parse(snapshot?.checkedAt);
  if (!Number.isFinite(checked) || checked > now + 60_000 || !Array.isArray(snapshot?.picks)) throw new Error("Invalid expert feed snapshot.");
  if (now >= checked + freshnessMs) return { status: "stale", checkedAt: snapshot.checkedAt, picks: [] };
  const text = (s, max) => typeof s === "string" && s.trim().length > 0 && s.length <= max;
  const picks = snapshot.picks.filter(p =>
    publisher(p?.sourceUrl) && text(p.analyst, 90) && text(p.event, 180) &&
    Date.parse(p.publishedAt) <= checked && Date.parse(p.startTime) > now &&
    Array.isArray(p.legs) && p.legs.length >= 2 && p.legs.length <= 8 && p.legs.every(s => text(s, 125)) &&
    (p.odds === null || /^[+-]\d{3,6}$/.test(p.odds))
  ).slice(0, 20).map(p => ({ ...p, publisher: publisher(p.sourceUrl) }));
  return { status: "ready", checkedAt: snapshot.checkedAt, expiresAt: new Date(checked + freshnessMs).toISOString(), picks };
}

export function createFeedReader(fetcher = fetch, clock = Date.now) {
  let snapshot, nextFetch = 0, inflight, unavailable = false;
  async function refresh() {
    try {
      const res = await fetcher(snapshotUrl, { signal: AbortSignal.timeout(5000), redirect: "error" });
      if (res.status === 404) {
        snapshot = null;
      } else {
        if (!res.ok) throw new Error(`Snapshot HTTP ${res.status}`);
        const data = await res.json();
        publicFeed(data, clock());
        snapshot = data;
      }
      unavailable = false;
      nextFetch = clock() + 5 * 60_000;
    } catch (error) {
      console.warn("Expert feed refresh failed:", error.message);
      unavailable = true;
      nextFetch = clock() + 60_000;
    }
  }
  return async () => {
    if (clock() >= nextFetch) await (inflight ??= refresh().finally(() => { inflight = null; }));
    if (!snapshot) return { status: unavailable ? "unavailable" : "pending", checkedAt: null, picks: [] };
    const result = publicFeed(snapshot, clock());
    return unavailable && result.status === "ready" ? { ...result, status: "cached" } : result;
  };
}
