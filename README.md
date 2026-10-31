# WiselyBet

Live sports odds, player props and parlay tracking in one dashboard. WiselyBet is a small Node.js server with no web framework: it serves plain HTML pages and a JSON API, signs users in with Firebase (or local accounts during development), and can send phone alerts and email.

Live site: https://wiselybet.onrender.com

> WiselyBet is an information tool. It doesn't take bets, and nothing in it is betting advice. Users must be of legal betting age where they live.

## Features

- **Odds board**: games and bookmaker odds for basketball, hockey, baseball, football and seven soccer leagues (Premier League, La Liga, Serie A, Bundesliga, Ligue 1, MLS and the Champions League) from The Odds API, with live scores and injury reports from ESPN.
- **Player props**: Over and Under tracking, form signals (good-form and warning icons) and followed players.
- **Trackers and parlays**: live progress for every pick, parlays that can share players, and a celebration when a parlay hits.
- **Best parlay bar**: choose a sport (or all sports at once), Over, Under or both, your sportsbook and 2 to 8 legs. Picks are ordered by the shortest price at that sportsbook, and live legs show time left, fouls and a minutes outlook. Remove any player, then open the slip at the sportsbook; the picks are tracked automatically.
- **Live game page**: a court view that acts out live basketball plays, and live match centers for soccer.
- **Accounts and sync**: settings, trackers and parlays follow the user across devices. New accounts get a free trial, and the subscription checkout is a demo.
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

Open http://127.0.0.1:3000 and create an account. Without Firebase settings the server uses local accounts stored in `data/` (ignored by git). Without `THE_ODDS_API_KEY`, odds requests answer `503` with a message saying the key is missing.

To use a key in PowerShell:

```powershell
$env:THE_ODDS_API_KEY = "your-key"; npm start
```

If a `firebase-key.json` file is in the project folder, the server switches to Firebase mode and uses that project. To force local accounts, set `FIREBASE_KEY_FILE` to a path that doesn't exist.

## Configuration

All settings come from environment variables.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port. |
| `HOST` | `127.0.0.1` | Address to listen on. Use `0.0.0.0` on a host. |
| `NODE_ENV` | (none) | `production` adds HSTS and marks the session cookie `Secure`. |
| `THE_ODDS_API_KEY` | (none) | Key for [The Odds API](https://the-odds-api.com). Needed for odds. |
| `ODDS_REGIONS` | `us` | Bookmaker regions requested from The Odds API. |
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
2. In the Render dashboard, set `THE_ODDS_API_KEY`, `FIREBASE_KEY_JSON` and `FIREBASE_WEB_JSON`. Optionally add the `VAPID_*`, `SMTP_*`, `MAIL_TO` and `SUPPORT_EMAIL` settings.
3. After a deploy, `GET /healthz` answers `ok`.

Use Firebase mode in production. The free Render plan has no persistent disk, so local accounts in `DATA_DIR` would be lost on every deploy.

## Project layout

| Path | Purpose |
| --- | --- |
| `server.mjs` | HTTP server: pages, JSON API, odds and ESPN data, security headers. |
| `auth.mjs` | Accounts, sessions, synced user data and subscriptions (Firebase or local JSON). |
| `push.mjs` | Web Push subscriptions and the background checks behind phone alerts. |
| `best-parlay.mjs` | Builds the Best parlay suggestions from live box scores and odds. |
| `soccer.js` | Soccer leagues and helpers shared by the server and the pages. |
| `index.html` | Main app: odds, props, trackers, parlays and settings. |
| `game.html` | Live game page. |
| `login.html`, `subscribe.html` | Sign-in, subscription and account pages. |
| `terms.html`, `privacy.html`, `responsible-gaming.html`, `404.html`, `legal.css` | Public legal and error pages. |
| `client-errors.js` | Reports browser errors to `/api/client-error`. |
| `icons/` | App icons. |
| `*.test.cjs`, `*.test.mjs` | Tests. |

## Responsible gambling

Gambling involves risk. If betting stops being fun, call or text 1-800-GAMBLER (US) or visit https://www.ncpgambling.org. More help links are on the app's [Responsible gaming](https://wiselybet.onrender.com/responsible-gaming) page.
