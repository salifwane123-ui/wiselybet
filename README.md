# WiselyBet

Live sports odds, player props and parlay tracking in one dashboard. WiselyBet is a small Node.js server with no web framework: it serves plain HTML pages and a JSON API, signs users in with Firebase (or local accounts during development), and can send phone alerts and email.

Live site: https://wiselybet.onrender.com

> WiselyBet is an information tool. It doesn't take bets, and nothing in it is betting advice. Users must be of legal betting age where they live.

## Features

- **Odds board**: games and bookmaker odds for basketball, hockey, baseball, football and seven soccer leagues (Premier League, La Liga, Serie A, Bundesliga, Ligue 1, MLS and the Champions League) from the configured odds provider, with live scores and injury reports from ESPN.
- **Player props**: Over and Under tracking, form signals (good-form and warning icons) and followed players.
- **Player search**: type a name in **Find a player** to see matching and similarly spelled players from every team in the selected sport, such as "lebrn" for LeBron James or "SGA" for Shai Gilgeous-Alexander. Names come from ESPN rosters (FBS teams for college football), refreshed every 6 hours. Each suggestion shows the team, position, number and the player's listed game; choose one to open that game's props, filtered to the player. Players without a listed game are shown but can't be chosen. Use the arrow keys and Enter to choose, or Escape to close. The same matching also filters the prop cards of the selected game.
- **Trackers and parlays**: live progress for every pick, parlays that can share players, and a celebration when a parlay hits.
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
- **Best parlay bar**: open the compact sport dropdown to enable any combination of sports with checkboxes (or toggle All sports), choose Over, Under or both, your sportsbook and 2 to 8 legs. The game dropdown offers **Live only** (default), **Upcoming only**, or **Both**. Live only never fills gaps with upcoming picks; Upcoming only excludes live picks; Both can combine live and upcoming picks into one parlay across the selected sports. Suggestions may mix any positive or negative odds offered by your sportsbook. Live main and alternate lines are ranked globally by no-vig market probability plus a bounded live-performance adjustment, not price alone. Basketball considers pace, shooting, personal fouls, recorded minutes, starter/on-court status, positional bench competition, game closeness and the player's share of recorded team production. Estimated remaining minutes follow his observed rotation and foul risk. Other sports use their available live stats, participation and role signals; soccer does not borrow basketball pace forecasts. Bench readiness, future substitutions and coaching/tactical assignments cannot be verified from box scores. Upcoming picks use the highest market-implied percentages on the Player Props page (50%+), with no live-performance checks: best Over and Under main-line prices across sportsbooks at the same line, margin removed, with that line offered by your selected book as a main or alternate line. Where your book lacks that exact line, its nearest easier line (for example Over 224.5 for a 229.5 line) carries that line's percentage as a conservative estimate; picks are sorted highest percentage first. Both ranks these market estimates alongside live performance scores. These are heuristic rankings, not validated hit-rate predictions or guarantees; displayed probabilities remain market-implied estimates. One pick per player is retained. Fewer than the requested number of legs may qualify; suggestions pause below two eligible picks, including after removals. Stale fallback suggestions are excluded. Click outside or press Escape to close the sport dropdown. Unchecking every sport pauses suggestions until a sport is enabled again. Selections are saved and synced; existing single-sport preferences are preserved. Champions League props remain unavailable. Each leg's percentage carries the same heat color and flame as on Player Props (blue under 50%, then yellow, orange, red, and pink at 75%+). It counts up as each leg slides in or the leg list opens, while a thin heat meter fills to the percentage and the flame lights; picks at 65% or more catch a periodic shine, and refreshed prices tick over from the old value. **All legs** folds the leg list open, its legs rising in one after another, and **Hide legs** folds it shut; pressing midway turns it around, and the sport dropdown fades in as it opens. Motion is off when the device asks for reduced motion. Expand the leg list for performance notes. Remove any player, then press **Add to tracker** to follow the whole parlay in the Live tracker, set to your sportsbook; the button never opens the sportsbook, and once the parlay is tracked it shows it in the tracker instead. Each leg's own link in the leg list still opens that pick at the sportsbook and tracks it.
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

Open http://127.0.0.1:3000 and create an account. Without Firebase settings the server uses local accounts stored in `data/` (ignored by git). The local default provider is The Odds API. To use SportsDataIO instead, set its provider and a production API key:

```powershell
$env:ODDS_PROVIDER = "sportsdataio"; $env:SPORTSDATAIO_API_KEY = "your-production-key"; npm start
```

Never paste API keys into chat or commit them to the repository. SportsDataIO trial keys may return scrambled data; use production access for the live board.

If a `firebase-key.json` file is in the project folder, the server switches to Firebase mode and uses that project. To force local accounts, set `FIREBASE_KEY_FILE` to a path that doesn't exist.

## Configuration

All settings come from environment variables.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port. |
| `HOST` | `127.0.0.1` | Address to listen on. Use `0.0.0.0` on a host. |
| `NODE_ENV` | (none) | `production` adds HSTS and marks the session cookie `Secure`. |
| `ODDS_PROVIDER` | `the-odds-api` | `the-odds-api` (legacy/local default) or `sportsdataio`. |
| `SPORTSDATAIO_API_KEY` | (none) | Production key for SportsDataIO; required when `ODDS_PROVIDER=sportsdataio`. If empty, the server uses `THE_ODDS_API_KEY` as the SportsDataIO key. |
| `THE_ODDS_API_KEY` | (none) | Legacy provider key; required when `ODDS_PROVIDER=the-odds-api`. With `ODDS_PROVIDER=sportsdataio`, it is used only as a fallback for an empty `SPORTSDATAIO_API_KEY`. |
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

The server reads provider settings once at startup. For Render, set `ODDS_PROVIDER=sportsdataio` and `SPORTSDATAIO_API_KEY` in the dashboard before deploying; refreshing the browser alone cannot activate a changed key. Services that already hold the SportsDataIO key in `THE_ODDS_API_KEY` keep working, because the server falls back to that variable when `SPORTSDATAIO_API_KEY` is empty. Keep the key in Render's environment settings, not in chat or source control. The SportsDataIO adapter sends the key in the `Ocp-Apim-Subscription-Key` header and never in the request URL.

Player props, previews and parlay pricing share cached event odds. Matching requests and market subsets reuse completed or in-flight requests. Populated pre-game prices refresh after 8 minutes within an hour of game time, or 15 minutes further out, with expiry capped at game time. Live, unknown-start and empty responses refresh after at most 60 seconds. Each server instance has its own in-memory cache, which clears on restart. Provider usage limits and costs depend on the account; caching does not change those provider terms.

The Odds API's market/region credit model applies only when `ODDS_PROVIDER=the-odds-api`; see [its usage-cost guide](https://the-odds-api.com/liveapi/guides/v4/#get-event-odds).

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
2. In the Render dashboard, set `SPORTSDATAIO_API_KEY` to a production key, and set `FIREBASE_KEY_JSON` and `FIREBASE_WEB_JSON`. `render.yaml` selects `ODDS_PROVIDER=sportsdataio`. Optionally add the `VAPID_*`, `SMTP_*`, `MAIL_TO` and `SUPPORT_EMAIL` settings.
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
