# WiselyBet

Live sports odds, player props and parlay tracking in one dashboard. WiselyBet is a small Node.js server with no web framework: it serves plain HTML pages and a JSON API, signs users in with Firebase (or local accounts during development), and can send phone alerts and email.

Live site: https://wiselybet.onrender.com

> WiselyBet is an information tool. It doesn't take bets, and nothing in it is betting advice. Users must be of legal betting age where they live.

## Features

- **Matchday dashboard**: Scores and picks share a page. The scoreboard leads with games in play and the upcoming schedule. **Picks** jumps to the parlay builder and the separate analyst feed; **Browse game odds** opens the full match list. On phones, section links stay at the bottom. Sport, side and game-timing controls are under the builder’s expandable filters.
- **Odds board**: games and bookmaker odds for basketball, hockey, baseball, football and seven soccer leagues (Premier League, La Liga, Serie A, Bundesliga, Ligue 1, MLS and the Champions League) from the configured odds provider, with live scores and injury reports from ESPN.
- **Player props**: Over and Under tracking, form signals (good-form and warning icons) and followed players.
- **Player search**: type a name in **Find a player** to see matching and similarly spelled players from every team in the selected sport, such as "lebrn" for LeBron James or "SGA" for Shai Gilgeous-Alexander. Names come from ESPN rosters (FBS teams for college football), refreshed every 6 hours. Each suggestion shows the team, position, number and the player's listed game; choose one to open that game's props, filtered to the player. Players without a listed game are shown but can't be chosen. Use the arrow keys and Enter to choose, or Escape to close. The same matching also filters the prop cards of the selected game.
- **Trackers and parlays**: live progress for every pick, parlays that can share players, and a celebration when a parlay hits.
- **Broadcast-style tracking**: the pick monitor uses clearly separated stat lines, progress rails, compact box scores and quieter status colors. Stat updates keep their animations, while cards no longer continuously shake or flash. Game scoreboards sit above the playing surface with team-color accents, leaving the parquet court, marked football field, baseball diamond, hockey rink and soccer pitch unobstructed. Surfaces are illustrative, not live player-location feeds; the existing basketball play re-creations remain approximate. Both views adapt to mobile, light mode and reduced motion. Tracking, settlement, alerts and collapse behavior are unchanged.
- Each player pick in the Live tracker offers **Move to parlay** and **Copy to parlay**. Choose an existing group or create one; grouped picks can also return to single picks. Move removes only that copy from its previous group, while Copy keeps it there. The displayed line and Over/Under side are preserved; destination duplicates are updated rather than doubled. Previous-group sportsbook adjustments and decisions do not carry into a new group. Changes save and sync like other tracker edits.
- Tracking window headers show a **LIVE** badge whenever at least one pick has a verified game in progress, including when the window is collapsed. Its tooltip and accessible label identify the live-pick count; finished, scheduled and unavailable feeds do not count.
- Parlay tracking windows start collapsed after every page refresh, including parlays loaded by account sync. Manually expanded windows stay open during live updates in that page session; single-pick windows are unchanged.
- Within each parlay, unresolved live picks appear first, upcoming picks next, and already-hit picks last. Lost, void and unavailable picks sit between upcoming picks and hits. Ordering updates with the live feed, preserves the order within each category and does not change saved picks. Unders remain unresolved until the existing settlement rules mark them won.
- When the same pick belongs to multiple parlays, each score update shows one shared animation above the tracking windows, labeled with those parlays. Non-shared picks keep their window-specific animations; scores and progress still update in every copy.
- Failed parlays stop score animations, sounds and pick notifications, including phone push alerts. Live stats and history continue updating silently. Copies in active parlays or tracked as singles continue alerting; independently followed players are unaffected. All legs are evaluated before sending updates so a newly failed parlay is muted in the same polling cycle.
- Each tracker pick-dot group slides back and forth only when its dots overflow the available width, keeping the parlay badge and label stationary. Resizing recalculates the travel distance; reduced-motion mode wraps the dots instead.
- Each parlay's sportsbook dropdown returns to **Choose sportsbook…** after opening its sportsbook button or after its 60-second selection timer expires. Selection and unanswered suggestion timers keep counting when the tracking panel or parlay card is closed; reopening checks elapsed time even if the browser delayed a background timer. Recorded sportsbook, targets and odds remain intact for tracking and payout calculations. Selecting a sportsbook again starts a fresh timer.
- NFL player props include **Anytime Touchdown** when offered by the odds provider. Track the Yes pick as one touchdown, individually or in a parlay. Live tracking and phone alerts count rushing, receiving, defensive and kick/punt return touchdowns; passing touchdowns, extra points and two-point conversions are excluded. No score loses only when the game finishes. Missing final participation is treated as no action; confirm your sportsbook's void rules. Sportsbook Yes/No prices and links are retained, and no unsupported alternate market is requested.
- NFL player props also include **Passing + rushing yards** and **Rushing + receiving yards**, with alternate lines when offered. Live tracking and phone alerts add the player's yards from the live box score (negative rushing yards included); the tracking window shows the component stats.
- **Best parlay bar**: the default **Smart pair** requires two different games and at least two distinct sportsbooks pricing both sides of each exact half-point line. Each book's margin-adjusted estimate must reach 75%, and a live pick must also clear 75% after its box-score adjustment. If only one game qualifies, no ticket is shown. These are market estimates, not measured win rates: two independent 75% legs imply about 56% for the pair. **Standard · 2–8 legs** restores the broader selection rules. Choose any combination of sports, Over/Under or both, and a sportsbook. **Live only** (default) never fills gaps with upcoming picks; **Upcoming only** excludes live picks; **Both** ranks them together. Main and alternate lines and either odds sign can qualify. There is one pick per player; suggestions pause below two eligible picks, including after removals. Stale fallback suggestions are excluded. Click outside or press Escape to close the sport dropdown. Clearing all sports pauses suggestions. Selections are saved and synced; Champions League props remain unavailable.
- **Per-pick hit estimates**: the carousel and **All legs** show the estimate and whether it is live-adjusted or odds-only. Live picks also show the no-vig odds baseline. In basketball the live adjustment uses pace, shooting, personal fouls, observed minutes, starter/on-court status, bench competition, score margin and share of team production. The court-minutes estimate follows observed rotation and foul risk, not a confirmed substitution schedule. Other sports use their available box-score and participation signals without inventing future minutes. The live estimate takes the no-vig probability `p` and adds `4 × p × (1 − p) × liveAdjustment` (the adjustment is bounded to ±0.12), tapering its effect at extreme odds. Picks rank by these estimates. Upcoming picks use the highest Player Props market probabilities (50%+), with the margin removed; an easier line offered by the selected book can inherit a harder line's estimate. The combined estimate multiplies the leg estimates assuming independence; same-game outcomes can be correlated. These are heuristics, not validated hit rates.
- **Bettors** means unique people on that exact player, side and line at the selected sportsbook. Current feeds do not supply this count, so picks show **Not reported**. Only an explicit nonnegative integer `bettorCount` on that book's outcome is displayed; ticket totals, percentages, public picks and the number of books quoting a line are not substitutes. Popularity is not part of the hit estimate.
- Each leg retains the Player Props heat colors, flame and count-up; reduced-motion preferences disable the animation. Expand **All legs** for the performance notes, or remove a player for the next eligible pick. **Add to tracker** follows the whole parlay at your chosen sportsbook without opening it; each leg's own link still opens and tracks that pick.
- **Parlay odds budget**: suggestions continue requesting fresh odds even when the provider reports low remaining credits; there is no app-level reserve cutoff. Fresh cached responses still avoid duplicate requests. This can exhaust credits shared with the live-odds board. If the provider rejects a request, suggestions show an error rather than reuse stale picks.
- **Live game page**: a court view that acts out live basketball plays, and live match centers for soccer.
- **Accounts and sync**: settings, trackers and parlays follow the user across devices. New accounts get a free trial, and the subscription checkout is a demo.
- **Light and dark themes**: dark by default; Settings → Theme switches the dashboard, live game pages, sign-in, subscribe and legal pages to a daylight palette. Pages apply the saved theme before first paint, and the browser bar color follows it.
- **Phone alerts**: Web Push notifications for hits, close calls, fouls, injuries and final results.
- **Responsible play**: optional time-check reminders, a 24-hour, 7-day or 30-day break that locks the app on every device, and links to help lines.
- **Privacy controls**: download my data, delete my account, and public Terms, Privacy and Responsible gaming pages.
- **Feedback and error reports**: an in-app feedback form that emails the team, and browser errors reported to the server log.
- **Hardening**: security headers (CSP, plus HSTS in production), rate limits, a 404 page, `robots.txt`, `/healthz` and a graceful shutdown.

## Requirements

- Node.js 22 or newer (required by `firebase-admin`)
- npm

## Run locally

```bash
npm install
npm start
```

Open http://127.0.0.1:3000 and create an account. Without Firebase settings the server uses local accounts stored in `data/` (ignored by git). The default provider for local development and Render is The Odds API. Set its provider and API key before starting:

```powershell
$env:ODDS_PROVIDER = "the-odds-api"; $env:THE_ODDS_API_KEY = "your-api-key"; npm start
```

Never paste API keys into chat or commit them to the repository. SportsDataIO remains available as an opt-in provider (see below).

If a `firebase-key.json` file is in the project folder, the server switches to Firebase mode and uses that project. To force local accounts, set `FIREBASE_KEY_FILE` to a path that doesn't exist.

## Configuration

All settings come from environment variables.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port. |
| `HOST` | `127.0.0.1` | Address to listen on. Use `0.0.0.0` on a host. |
| `NODE_ENV` | (none) | `production` adds HSTS and marks the session cookie `Secure`. |
| `ODDS_PROVIDER` | `the-odds-api` | `the-odds-api` (local and Render default) or `sportsdataio`. |
| `SPORTSDATAIO_API_KEY` | (none) | Production key for SportsDataIO; required when `ODDS_PROVIDER=sportsdataio`. If empty, the server uses `THE_ODDS_API_KEY` as the SportsDataIO key. |
| `THE_ODDS_API_KEY` | (none) | The Odds API key; required when `ODDS_PROVIDER=the-odds-api`. With `ODDS_PROVIDER=sportsdataio`, it is used only as a fallback for an empty `SPORTSDATAIO_API_KEY`. |
| `ODDS_REGIONS` | `us` | Bookmaker regions requested by The Odds API. |
| `FIREBASE_KEY_JSON` | (none) | Firebase service-account JSON, raw or base64. |
| `FIREBASE_KEY_FILE` | `./firebase-key.json` | Service-account file, used when `FIREBASE_KEY_JSON` is empty. |
| `FIREBASE_WEB_JSON` | `./firebase-web.json` | Firebase web config (`apiKey`, `authDomain`, `projectId`, `appId`). |
| `DATA_DIR` | `./data` | Folder for local accounts and sessions (local mode only). |
| `TRIAL_MINUTES` | `5` | Free-trial length for new accounts. |
| `SUBSCRIPTIONS_DEMO` | on | Demo checkout that takes no payment. `0` turns checkout off until real payments are connected. |
| `VAPID_PUBLIC`, `VAPID_PRIVATE` | (none) | Web Push keys. Phone alerts are off without them. Create a pair with `npx web-push generate-vapid-keys`. |
| `VAPID_SUBJECT` | owner's `mailto:` | Contact URL sent to push services. |
| `SMTP_HOST`, `SMTP_PORT` | `smtp.gmail.com`, `465` | Mail server for feedback and parlay recaps. |
| `SMTP_USER`, `SMTP_PASS` | (none) | Mail login. Without it, Firebase mode queues mail in the Firestore `mail` collection (for the Trigger Email extension), and local mode can't send mail. |
| `MAIL_TO` | owner's inbox | Where feedback and recaps are delivered. |
| `MAIL_DRY_RUN` | (none) | `1` builds messages without sending them. The tests use this. |
| `SUPPORT_EMAIL` | (none) | Public support address shown on the legal pages. Without it, they point to the in-app feedback form. |

Keep secrets such as `firebase-key.json` and `.env` out of git; both are listed in `.gitignore`.

### Odds providers and key changes

The server reads provider settings once at startup. For Render, set `ODDS_PROVIDER=the-odds-api` and save your active key from [The Odds API dashboard](https://dash.the-odds-api.com/) in `THE_ODDS_API_KEY`, then save and deploy; refreshing the browser alone cannot activate a changed key. When switching back from SportsDataIO, make sure `THE_ODDS_API_KEY` contains a key issued by The Odds API, not a SportsDataIO key stored there during the previous setup. `SPORTSDATAIO_API_KEY` is ignored when The Odds API is selected. Keep keys in Render's environment settings, not in chat or source control.

To opt into SportsDataIO, set `ODDS_PROVIDER=sportsdataio` and `SPORTSDATAIO_API_KEY` to a production key, then restart or deploy. If that variable is empty, the server falls back to `THE_ODDS_API_KEY`, which must then contain a SportsDataIO key instead. The SportsDataIO value may contain several keys separated by commas (for example one key per league); the server tries each and remembers the one that works for each league. Surrounding quotes and labels such as `key=` are ignored. If SportsDataIO rejects every key, the server logs each key's length, format and a short fingerprint (never the key) and asks for the active production key. The adapter sends the key in the `Ocp-Apim-Subscription-Key` header and never in the request URL. SportsDataIO free-trial keys return scrambled odds (market, outcome and sportsbook names read "Scrambled"); the server reports this as an error, and the live board needs a paid production subscription. Soccer leagues need a plan that includes those competitions.

Player props, previews and parlay pricing share cached event odds. Matching requests and market subsets reuse completed or in-flight requests. Populated pre-game prices refresh after 8 minutes within an hour of game time, or 15 minutes further out, with expiry capped at game time. Live, unknown-start and empty responses refresh after at most 60 seconds. Each server instance has its own in-memory cache, which clears on restart. Provider usage limits and costs depend on the account; caching does not change those provider terms.

The Odds API's market/region credit model applies only when `ODDS_PROVIDER=the-odds-api`; see [its usage-cost guide](https://the-odds-api.com/liveapi/guides/v4/#get-event-odds).

## Automatic expert-picks feed

The dashboard's **Expert parlay suggestions** section shows upcoming same-game parlays from TheLines and SportsGambler. It is separate from Best parlay, requires no login, and does not place bets or add picks to a tracker. Every card links to the analyst's article. Combined American odds appear only if quoted for that ticket; they are not live prices.

The default **Smart filter** keeps complete two- or three-leg tickets whose published combined price implies at least 50%, highest implied probability first. This price includes the sportsbook's margin and is not a verified chance of winning. Choose **All published tickets** to include longer, unpriced or longer-odds tickets. The app never cuts legs from an analyst's ticket.

To activate:

1. Deploy the app changes to `main`. In GitHub **Settings → Secrets and variables → Actions**, add an Actions repository secret named `OPENAI_API_KEY` for a funded OpenAI project with access to `gpt-4.1-mini`. Do not put the key in Render, client code, the repo, or chat.
2. Enable GitHub Actions. Allow the **Publish expert picks** workflow to write its `expert-feed` data branch. Run it once from **Actions → Publish expert picks → Run workflow** on `main`; it is subsequently scheduled every three hours, including when Render sleeps. GitHub scheduled runs can be delayed.
3. Check the run and open the dashboard (or `GET /api/expert-picks`). Allow several minutes for GitHub and the app's read cache. Before first publication the board says it is waiting; a successful check with no qualifying games is a distinct empty state.

The collector checks the next 48 hours of confirmed NFL, NBA and men's NCAA basketball fixtures on ESPN. It looks for recent, explicitly grouped tickets on the two publisher sites, not arbitrary singles. At most one paid model request per run processes a bounded batch of public article excerpts; no user, tracker or sportsbook-account data is sent. The model selects source rows, not new picks. Each public snapshot contains just the attributed tickets, prices when supported, source URLs and dates. It lives on the public `expert-feed` branch of `salifwane123-ui/wiselybet`; refreshing the dashboard never calls the model or redeploys the app.

If a collector, publisher, schedule or model request fails, the workflow fails without overwriting the last snapshot. Check the failed run in Actions. Picks disappear at their scheduled start, and snapshots older than nine hours are not shown. Disable the workflow to stop future model calls.

## Tests

```bash
npm test
```

The suite uses Node's built-in `node:test` runner, so it needs no extra test packages.

- `server.test.mjs` starts the real server on a free port with local accounts, a temporary data folder and dry-run mail. It then checks pages, headers, feedback, error reports, breaks and account deletion.
- `page-scripts.test.cjs` parses every inline script in every page, so a syntax error can't blank a page in production.
- The other tests load code straight out of the pages and modules. Each one cuts a script out between fixed marker comments (for example `// Break lock:` in `index.html` or `// Live court:` in `game.html`) and runs it in `node:vm`. If you rename or move one of those comments, update the matching test.

Add every new test file to the `test` script in `package.json`. GitHub Actions (`.github/workflows/ci.yml`) checks script syntax and runs the full suite on Node 22 and 24 for every push to `main` and every pull request.

## Deploy

`render.yaml` describes the Render service, and every commit to `main` deploys to https://wiselybet.onrender.com.

1. Create the service from the blueprint.
2. In the Render dashboard, set `THE_ODDS_API_KEY` to your active key from The Odds API, and set `FIREBASE_KEY_JSON` and `FIREBASE_WEB_JSON`. `render.yaml` selects `ODDS_PROVIDER=the-odds-api`; for an existing service, also verify that its environment has this provider value and save and deploy after any key change. Optionally add the `VAPID_*`, `SMTP_*`, `MAIL_TO` and `SUPPORT_EMAIL` settings.
3. After a deploy, `GET /healthz` answers `ok`.

Use Firebase mode in production. The free Render plan has no persistent disk, so local accounts in `DATA_DIR` would be lost on every deploy.

## Project layout

| Path | Purpose |
| --- | --- |
| `server.mjs` | HTTP server: pages, JSON API, odds and ESPN data, security headers. |
| `auth.mjs` | Accounts, sessions, synced user data and subscriptions (Firebase or local JSON). |
| `push.mjs` | Web Push subscriptions and the background checks behind phone alerts. |
| `best-parlay.mjs` | Builds the Best parlay suggestions from live box scores and odds, or pre-game prop probabilities when no game is live. |
| `soccer.js` | Soccer leagues and helpers shared by the server and the pages. |
| `player-search.js` | Similar-name player matching shared by the server's `/api/players` roster search and the Player props search box. |
| `index.html` | Main app: odds, props, trackers, parlays and settings. |
| `game.html` | Live game page. |
| `login.html`, `subscribe.html` | Sign-in, subscription and account pages. |
| `terms.html`, `privacy.html`, `responsible-gaming.html`, `404.html`, `legal.css` | Public legal and error pages. |
| `client-errors.js` | Reports browser errors to `/api/client-error`. |
| `icons/` | App icons. |
| `*.test.cjs`, `*.test.mjs` | Tests. |

## Responsible gambling

Gambling involves risk. If betting stops being fun, call or text 1-800-GAMBLER (US) or visit https://www.ncpgambling.org. More help links are on the app's [Responsible gaming](https://wiselybet.onrender.com/responsible-gaming) page.
