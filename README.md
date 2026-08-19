# TarangOS

A private, secure personal productivity system — tasks, habits, focus, goals, reviews and
years of trustworthy history.

One account. No sign-up page. No telemetry. Deploy it to Vercel for access from your phone
around the clock, or self-host it and keep every byte on your own hardware.

---

## Contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Using it from your phone](#using-it-from-your-phone)
- [Deploying to Vercel](#deploying-to-vercel)
- [Deploying to your own server](#deploying-to-your-own-server)
- [Daily notifications](#daily-notifications)
- [Turning on HTTPS](#turning-on-https)
- [Security model](#security-model)
- [Abuse protection](#abuse-protection)
- [Backup and restore](#backup-and-restore)
- [If you forget your password](#if-you-forget-your-password)
- [Configuration](#configuration)
- [Project layout](#project-layout)
- [Development](#development)
- [How the productivity score works](#how-the-productivity-score-works)
- [Troubleshooting](#troubleshooting)

---

## What it does

**Plan** — Today view with drag-and-drop ordering, an Eisenhower matrix, and *Plan my day*,
which sorts your open tasks by priority, deadline, how often each has already slipped, and
estimated effort — then tells you exactly why it chose that order.

**Capture** — One line in, a structured task out:
`Gym tomorrow 7 PM high priority #health ~45m` becomes a task on tomorrow's date at 19:00,
priority high, tagged `health`, estimated 45 minutes. Everything it understood is shown back
to you before you commit.

**Track** — Tasks carry description, notes, date, start/due time, priority, category, tags,
status, estimated vs actual duration, reminders, subtasks and recurrence. Complete, reopen,
duplicate, postpone, reschedule, archive, bulk-edit.

**Repeat** — Daily, weekdays, weekly (specific days), monthly, yearly and custom recurrence.
Future occurrences are generated as real, individually-editable tasks, so a skipped Tuesday
shows up honestly as a missed task instead of quietly disappearing.

**Measure** — A 0–100 productivity score built from six weighted components, each of which
explains itself. Trend charts, category and priority breakdowns, weekday performance, a
six-month heatmap, streaks and personal records.

**Reflect** — End-of-day and weekly reviews, pre-filled with what actually happened so the
writing is reflection rather than recall. Tag *why* things were missed, and Analytics surfaces
the recurring reason.

**Remember** — Open any past date and see the tasks, the score, the review, the notes, the
focus sessions and the habits for that day. History is kept indefinitely.

**Focus** — Pomodoro and custom timers, optionally bound to a task, with time rolled back into
that task's actual duration. Survives a closed tab: elapsed time is derived from the server's
start timestamp.

**Habits** — Daily and weekly habits with streaks, best streaks, completion rates and a
six-month calendar heatmap you can click to backfill.

**Nudge** — A morning agenda notification at a fixed time each day (10:00 by default) telling
you how many tasks are planned, how many are high priority, and what to start with. Plus an
evening check on unfinished important work and a review nudge. See
[Daily notifications](#daily-notifications).

---

## Quick start

TarangOS needs a Postgres database. For local development the quickest options are a free
[Neon](https://neon.tech) branch, or Postgres in a container:

```bash
docker run -d --name tarangos-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
```

Then copy `.env.example` to `.env` and set `DATABASE_URL` and `DIRECT_URL`.

Requires Node.js 20 or newer.

```bash
npm run setup
```

```bash
npm run build
```

```bash
npm start
```

Then open **http://localhost:4517**.

The first screen asks you to create the single admin account. There is no second user and no
public sign-up — the bootstrap endpoint refuses to run once an account exists.

---

## Using it from your phone

TarangOS is an installable PWA with a mobile bottom navigation, so it behaves like a native app.

1. Make sure your laptop and phone are on the same Wi-Fi network.
2. Start the server. It prints every address it is reachable on, for example:

   ```
   TarangOS is running

      http://localhost:4517
      http://192.168.1.42:4517
   ```

3. On your phone, open the `192.168.x.x` address.
4. Install it: **Safari → Share → Add to Home Screen**, or **Chrome → ⋮ → Install app**.

The server binds to `0.0.0.0` by default so this works out of the box. To restrict it to the
local machine only, set `HOST=127.0.0.1` (or change the compose port mapping to
`127.0.0.1:4517:4517`).

Your Windows or macOS firewall may prompt the first time — allow it on **private networks only**.

> **Note on cookies over plain HTTP.** Session cookies are marked `Secure` by default, which
> browsers only send over HTTPS. For plain-HTTP LAN access set `ALLOW_INSECURE_COOKIE=true`
> (the Docker compose file already does). Better still, turn on HTTPS below.

---

## Deploying to Vercel

TarangOS runs on Vercel, with one requirement: **the database has to live somewhere else.**

Serverless functions have no durable disk and no memory between requests. Everything that
assumed one has been adapted — the database is Postgres, secrets come from environment
variables, rate limits and IP blocks are shared through the database, and scheduled
housekeeping runs from Vercel Cron instead of an in-process timer.

### 1. Create a Postgres database

**Easiest — from inside Vercel.** Open your project, go to the **Storage** tab, choose
**Create Database → Neon** (free tier), and connect it. Vercel injects the connection
variables into the project automatically and TarangOS reads whichever names it finds — there is
nothing to copy.

**Or bring your own.** Create a database at [Neon](https://neon.tech) or
[Supabase](https://supabase.com) and set these yourself:

| Variable | Which string |
| --- | --- |
| `DATABASE_URL` | pooled — what the app uses at runtime |
| `DIRECT_URL` | direct / unpooled — migrations only, since a pooler cannot run them |

If your provider gives you one URL, use it for both. These are also read from the names the
Vercel integrations use (`POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`,
`DATABASE_URL_UNPOOLED`), so either style works.

> Do not paste the example string from `.env.example`. Its host is literally `host`, and the
> build stops with a message telling you so rather than a confusing connection timeout.

### 2. Generate your secrets

```bash
node -e "console.log('ENCRYPTION_KEY='+require('crypto').randomBytes(32).toString('hex'));console.log('SESSION_PEPPER='+require('crypto').randomBytes(32).toString('hex'));console.log('CRON_SECRET='+require('crypto').randomBytes(24).toString('hex'))"
```

> `SESSION_PEPPER` is mixed into your password hash. Set it once and never change it — if it
> changes, your password stops working and you are locked out of your own account. TarangOS
> refuses to start on serverless without these rather than inventing new ones per cold start,
> which is exactly what that lockout would look like.

### 3. Import the repo into Vercel

Point Vercel at this repository. `vercel.json` already sets the build, output directory,
routing and cron, so no framework preset is needed.

Add these environment variables in **Project → Settings → Environment Variables**:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | pooled Postgres URL — set for you if you used Storage → Create Database |
| `DIRECT_URL` | direct Postgres URL — same note |
| `ENCRYPTION_KEY` | from step 2 |
| `SESSION_PEPPER` | from step 2 |
| `CRON_SECRET` | from step 2 |
| `TRUST_PROXY` | `true` — Vercel's edge sets `X-Forwarded-For` |
| `NODE_ENV` | `production` |

Deploy. The build runs `prisma migrate deploy`, which creates all 19 tables on first deploy
and applies only new changes afterwards.

### 4. Claim your account immediately

There is no sign-up page: **the first visitor to reach the site creates the single admin
account**, and the endpoint refuses forever after. Open your deployment and create yours
before anyone else finds the URL.

### What changes on Vercel

| | Self-hosted | Vercel |
| --- | --- | --- |
| Database | Postgres you run | Postgres you host (Neon/Supabase/…) |
| Backup **files** | Written daily to `data/backups/` | Unavailable — no durable disk |
| Export / import / restore | Works | Works, through your browser |
| Scheduled housekeeping | In-process timer, every 15 min | Vercel Cron, daily |
| Rate limits | In memory | Credential limits shared via the database |
| IP blocks | In memory + database | Database, so every instance agrees |

The only real loss is server-written backup files. **Use Settings → Data → Full export (JSON)
regularly** — it contains everything, and Restore takes it back.

### The privacy trade-off, stated plainly

The original design kept every task title on your own machine. Hosting it means your data now
lives on Vercel's compute and your database provider's servers. It is still a single private
account behind a password, 2FA and the abuse protection — but "nothing ever leaves my
machine" is no longer true. That is the price of 24/7 access from your phone without leaving a
laptop running, and it is a reasonable trade — it should just be a knowing one.

---

## Deploying to your own server

If you would rather keep the data on hardware you control, deploy to a machine with a real
disk: a VPS, a home server, or a Raspberry Pi. You still need Postgres, but it can be a
container on the same box.

### 1. Get the code and build

```bash
git clone https://github.com/Tarangv12/tarang-os-.git && cd tarang-os-
```

```bash
npm run setup && npm run build
```

### 2. Configure

```bash
cp .env.example .env
```

At minimum set `ENCRYPTION_KEY` and `SESSION_PEPPER` to real random values, so they are stable
and not regenerated into `data/`:

```bash
node -e "console.log('ENCRYPTION_KEY='+require('crypto').randomBytes(32).toString('hex'));console.log('SESSION_PEPPER='+require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Keep it running

With systemd, create `/etc/systemd/system/tarangos.service`:

```ini
[Unit]
Description=TarangOS
After=network.target

[Service]
Type=simple
User=tarangos
WorkingDirectory=/opt/tarangos
EnvironmentFile=/opt/tarangos/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now tarangos
```

Or with PM2: `pm2 start "npm start" --name tarangos && pm2 save && pm2 startup`.

### 4. Put HTTPS in front

Terminate TLS with a reverse proxy so your session cookie and task titles are encrypted in
transit. With [Caddy](https://caddyserver.com), the whole config is:

```
tarang.example.com {
    reverse_proxy 127.0.0.1:4517
}
```

Then set **`TRUST_PROXY=true`** in `.env` — and only then. That setting makes
`X-Forwarded-For` authoritative for rate limiting and IP blocking, which is correct behind a
proxy you control and dangerous without one. See [Abuse protection](#abuse-protection).

Also set `HOST=127.0.0.1` so the Node process is reachable only through the proxy, and leave
`ALLOW_INSECURE_COOKIE=false` now that you have real HTTPS.

### 5. Back it up

Everything lives in `data/`. A nightly copy off the machine is the whole backup strategy:

```bash
0 3 * * * cd /opt/tarangos && npm run backup && rsync -a data/backups/ user@elsewhere:/backups/tarangos/
```

### Updating

```bash
git pull && npm run setup && npm run build && sudo systemctl restart tarangos
```

`npm run setup` applies any schema changes to your existing database without touching your
data. Take a backup first anyway.

> **One account, deliberately.** There is no sign-up page — the first visit creates the single
> admin account and the endpoint refuses forever after. If you put this on a public domain,
> create your account immediately so nobody else claims it first.

---

## Daily notifications

TarangOS sends three fixed-time nudges each day, configured under **Settings → Notifications →
Daily schedule**. They are for you alone — there is one account and no way to notify anyone else.

| Nudge | Default | What it says |
| --- | --- | --- |
| **Morning agenda** | **10:00** | *"Good morning, Vrushabh — 3 tasks today · 1 high priority · first: Daily standup at 09:30"* |
| Unfinished important work | 20:00 | High-priority tasks still open, so nothing important slips silently |
| Daily review nudge | 21:00 | Prompts the end-of-day review — automatically skipped if you already wrote it |

Change the time with the picker or the one-tap presets, and use **Send a test notification** to
see exactly what will arrive without waiting until tomorrow.

### How delivery works

Each nudge **fires once per day**. The date it last fired is recorded against your account on the
server, so having TarangOS open on both your laptop and your phone cannot double-notify you.

If TarangOS was closed at 10:00, the agenda is **not lost** — it arrives the first time you open
the app afterwards, within a bounded catch-up window (6 hours for the morning agenda, 3 for the
evening ones). That window is deliberate: a "good morning" notification at 11 PM is noise, so
after it passes the day is skipped rather than delivered late.

### What is required for it to reach you

Notifications are raised by **your own browser** — there is no push server, which is why your
task titles never leave your machine. That means:

- **On your phone:** install TarangOS to the home screen (**Share → Add to Home Screen** on iOS,
  **⋮ → Install app** on Android). Once installed it can notify you even when the app is not in
  the foreground, as long as your phone can reach the server.
- **On your laptop:** keep TarangOS open in a tab, or installed as an app.
- Allow notifications when the browser asks. If you previously blocked them, re-enable the site
  in your browser settings and reload.

**The honest limitation:** if the machine running TarangOS is off, or every TarangOS window is
closed on every device, nothing can fire at 10:00 — it will simply arrive when you next open the
app. A local-first app with no cloud has no way around this. If you ever want notifications that
arrive with the app fully closed, that requires web push through a third-party push service,
which is a real privacy trade-off — ask and it can be added as an opt-in.

---

## Turning on HTTPS

Serving over TLS means your task titles and session cookie are encrypted even on your own
Wi-Fi, and it lets you keep `ALLOW_INSECURE_COOKIE=false`.

Generate a self-signed certificate for your machine's LAN address:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 825 -keyout data/tarangos-key.pem -out data/tarangos-cert.pem -subj "/CN=tarangos" -addext "subjectAltName=IP:192.168.1.42,DNS:localhost"
```

Replace `192.168.1.42` with your actual LAN IP. Then set:

```
TLS_KEY_FILE=./data/tarangos-key.pem
TLS_CERT_FILE=./data/tarangos-cert.pem
ALLOW_INSECURE_COOKIE=false
```

Restart, and TarangOS serves HTTPS directly. Your browser will warn once about the self-signed
certificate — that is expected; accept it, or install the certificate on your devices to remove
the warning permanently.

For a certificate with no warnings at all, put TarangOS behind [Caddy](https://caddyserver.com)
or a [Tailscale](https://tailscale.com) tailnet and set `TRUST_PROXY=true`.

---

## Security model

TarangOS is designed for exactly one person, so it optimises for *no remote attack surface*
rather than for account recovery convenience.

| Layer | What is implemented |
| --- | --- |
| **Accounts** | Exactly one. No sign-up page; the bootstrap endpoint 403s once an account exists. |
| **Passwords** | scrypt (N=32768, r=8, p=2) with a per-install pepper and per-password salt. Strength rules enforced server-side. |
| **Two-factor** | Optional TOTP (RFC 6238), compatible with any authenticator app. Ten single-use recovery codes. The TOTP seed is stored AES-256-GCM encrypted. |
| **Sessions** | Opaque 48-byte tokens, stored only as SHA-256 hashes. `httpOnly`, `SameSite=Strict`, `Secure` cookies. Sliding idle window plus a hard absolute ceiling. Tokens rotate on unlock and password change. |
| **Auto-lock** | After 20 minutes of inactivity the session locks and needs a PIN or your password. The API returns `423` and refuses to serve data until it is unlocked. |
| **Quick PIN** | Optional 4–12 digit code for unlocking only — never accepted at sign-in. |
| **Brute force** | Rate limits on login (10 / 15 min) and unlock (12 / 10 min), plus account lockout after 7 failures. Unknown usernames still run a hash comparison so timing does not leak account existence. |
| **Abuse** | Tiered rate limits keyed on the real peer address, plus automatic escalating IP blocks for scanners and sustained attacks. See [Abuse protection](#abuse-protection). |
| **CSRF** | Per-session token required in a header on every mutating request, on top of `SameSite=Strict`. |
| **Cross-origin** | Non-same-origin mutating requests are rejected outright. |
| **Headers** | Strict CSP with no `unsafe-eval`, `frame-ancestors 'none'`, `no-referrer`, HSTS when TLS is on, and `noindex` on every response. |
| **Audit trail** | Every sign-in, lock, unlock, credential change, backup and restore is logged with IP and timestamp, visible under Settings → Security. |
| **Data at rest** | A Postgres database you choose and control. The service worker deliberately never caches API responses. |
| **Restores** | Rewriting your data requires re-entering your password, and a safety backup is taken first. |
| **Dependencies** | All crypto uses Node's built-in `crypto`. No native modules, no password-hashing add-ons, and a deliberately small dependency tree. |

Secrets (`ENCRYPTION_KEY`, `SESSION_PEPPER`) are generated on first run into
`data/.secrets.json` with `0600` permissions if you do not supply them. Set them explicitly for
a reproducible deployment.

---

## Abuse protection

Rate limiting, automatic blocking and bot defences, all keyed on the caller's real
network address.

### The identity everything keys on

Every control below counts against `X-Forwarded-For` **only** when `TRUST_PROXY=true`,
meaning a proxy you control set it. Otherwise the TCP peer address is used, which cannot be
forged over a completed handshake.

This matters more than the limits themselves: a limiter keyed on a header the caller
controls is decorative, because an attacker simply sends a new value per request and gets a
fresh budget every time. IPv6 callers are counted per `/64` rather than per address, so being
handed a large prefix does not hand you a large number of buckets.

> Only set `TRUST_PROXY=true` when a proxy really is in front. Exposed directly, it
> re-opens exactly the bypass it exists to prevent.

### Rate limits

| Surface | Budget | Why |
| --- | --- | --- |
| Sign-in | 10 / 15 min | Successful sign-ins are not counted, so normal use never trips it |
| Unlock (PIN) | 12 / 10 min | Short codes get a smaller budget than passwords |
| Account creation | 5 / hour | Only one account can ever exist; this closes a first-boot race |
| Generation (natural-language capture, planning) | 30 / min | Reserved for the endpoints a language model would sit behind |
| Analytics & history | 40 / min | Every one of these fans out across the whole dataset |
| Search & task lists | 60 / min | What a scraper actually walks to pull data out in bulk |
| Writes | 120 / min | Stops a script filling the database |
| Everything else under `/api` | 300 / min | Generous enough to be invisible in real use |
| Restore, import, export | 20 / hour | Rare by nature, expensive by size |

Exceeding a limit returns `429` with a `Retry-After` header and a machine-readable
`RATE_LIMITED` code — and counts against you, below.

### Automatic blocking

Rate limiting only slows an attacker down; they pace themselves and keep going. So TarangOS
also scores the *shape* of traffic and removes a source entirely once it is clearly hostile:

| Behaviour | Weight |
| --- | --- |
| Scanning for `/.env`, `/wp-login.php`, `/phpmyadmin`, path traversal | 12 |
| Cross-origin write attempt / CSRF failure | 6 |
| Failed sign-in | 4 |
| Failed unlock | 3 |
| Breaking a rate limit | 2 |

At **24 points within 15 minutes** the source is blocked outright across the entire surface.
Blocks **escalate** — 15 minutes, then 1 hour, 6 hours, 24 hours — and are **persisted**, so
restarting the server does not hand an attacker a clean slate. Two scanner probes are enough;
a few password typos are nowhere near.

The block takes effect synchronously, before the next request is served, so a burst cannot
slip through the gap while it is being written to disk.

**You can never lock yourself out.** Requests from the machine running TarangOS
(`127.0.0.1`, `::1`) are exempt from automatic blocking — the ordinary account lockout still
applies, and it expires on its own.

See and release blocks under **Settings → Security → Blocked sources**.

### Bots and scraping

- `robots.txt` disallows everything, and every response carries `X-Robots-Tag: noindex`.
- Scanner paths get a bare `404` with nothing to fingerprint, and count heavily toward a block.
- Scraping the API requires a valid session, a matching CSRF token and a same-origin request —
  an anonymous crawler gets `401` on every data endpoint.
- Result sizes are capped server-side, so a large `limit` cannot be used to pull the dataset
  in one call.
- Request bodies are capped at 1 MB everywhere except restore and import, which opt into
  12 MB; anything larger is rejected at the parser with `413` rather than being buffered.
- Automated user agents (`curl`, `python-requests`, headless browsers, known crawlers) are
  recognised, but deliberately **not** blocked on that basis alone — a user agent is trivially
  forged, so treating it as an authorisation decision would stop honest tools while doing
  nothing to a real attacker.

### Testing it

```bash
npm --prefix server run test:abuse
```

Then, against a **throwaway** instance — never your real one:

```bash
BASE=http://127.0.0.1:4518 npm --prefix server run test:abuse:e2e
```

The end-to-end suite needs `TRUST_PROXY=true` on that instance so it can present itself as a
non-loopback client, since loopback is intentionally exempt from blocking.

---

## Backup and restore

**Automatic.** A full JSON backup is written to `data/backups/` once a day while the app is
running. The newest 30 automatic and 30 manual backups are kept.

**Manual.** Settings → Data & backups → *Back up now*. Or from the command line:

```bash
npm run backup
```

**Export.** Full JSON (everything) or CSV (tasks) from the same screen. The CSV export is
protected against spreadsheet formula injection.

**Import.** CSV import with a dry-run preview; the only required column is `title`. JSON import
merges an export from another machine.

**Restore.** Choose a saved backup or upload a `.json` export, pick *merge* or *replace*, and
confirm with your password. A safety backup is always written before a replace.

**The simplest backup of all:** copy the entire `data/` folder. It contains the database, the
backups and the secrets.

---

## If you forget your password

There is deliberately no reset email and no recovery link — for a single-user private system
those are the weakest link, not a convenience. Recovery happens on the machine that holds the
database:

```bash
npm run reset-admin -- --password "a new strong password"
```

```bash
npm run reset-admin -- --disable-2fa --clear-pin --clear-lockout
```

Run with no arguments to see the account's current state. Any credential change signs out every
existing session.

Under Docker:

```bash
docker compose exec tarangos npx tsx src/scripts/resetAdmin.ts --clear-lockout
```

---

## Configuration

Copy `.env.example` to `.env` and edit. Every value has a working default.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4517` | HTTP port |
| `HOST` | `0.0.0.0` | Set to `127.0.0.1` to disable LAN access |
| `DATABASE_URL` | `file:../../data/tarangos.db` | SQLite location |
| `DATA_DIR` | `./data` | Database, backups and secrets |
| `ENCRYPTION_KEY` | generated | AES-256-GCM key for the TOTP seed |
| `SESSION_PEPPER` | generated | Extra secret mixed into password hashing |
| `SESSION_IDLE_MINUTES` | `720` | Sliding session window |
| `SESSION_ABSOLUTE_DAYS` | `30` | Hard session ceiling |
| `AUTO_LOCK_MINUTES` | `20` | Inactivity before the session locks |
| `MAX_FAILED_LOGINS` | `7` | Failures before lockout |
| `LOCKOUT_MINUTES` | `15` | Lockout duration |
| `MIN_PASSWORD_LENGTH` | `12` | Minimum password length |
| `ALLOW_INSECURE_COOKIE` | `false` | Set `true` for plain-HTTP LAN access |
| `TRUST_PROXY` | `false` | Set `true` behind Caddy/nginx/Tailscale |
| `TLS_KEY_FILE` / `TLS_CERT_FILE` | — | Serve HTTPS directly |
| `AUTO_BACKUP` | `true` | Daily automatic backups |
| `BACKUP_KEEP` | `30` | Backups retained per kind |

---

## Project layout

```
.
├── vercel.json              serverless build, routing and cron
├── api/index.ts             Vercel function wrapping the Express app
├── docker-compose.yml       one-command self-hosted deployment
├── Dockerfile               multi-stage build (web + server → one image)
├── data/                    YOUR DATA — database, backups, secrets (git-ignored)
├── server/
│   ├── prisma/schema.prisma full data model (Postgres)
│   ├── prisma/migrations/    generated SQL, applied by `prisma migrate deploy`
│   ├── test/smoke.mjs       58-check end-to-end API test
│   └── src/
│       ├── config.ts        env + secret bootstrapping
│       ├── index.ts         express app, CSP, static SPA, TLS
│       ├── scheduler.ts     daily backups, session purge, recurrence top-up
│       ├── lib/             crypto, session, metrics, recurrence, quick-capture,
│       │                    backup, abuse, net, rateStore, notifications
│       ├── middleware/      auth, CSRF, origin guard, rate limits
│       ├── routes/          auth, tasks, org, goals, habits, focus, notes,
│       │                    reviews, dashboard, analytics, settings, backup
│       └── scripts/         resetAdmin.ts, backup.ts
└── web/
    ├── public/              manifest, service worker, generated icons
    └── src/
        ├── components/      design system, task components, charts, shell
        ├── hooks/           shared task actions
        ├── lib/             API client, query hooks, types, utils
        ├── pages/           the 14 screens
        └── state/           auth, theme, reminders
```

---

## Development

```bash
npm run setup
```

```bash
npm run dev
```

The API runs on `:4517` and Vite on `:5417` with `/api` proxied. Both listen on all interfaces,
so you can develop against your phone.

Other commands:

```bash
npm run typecheck
```

```bash
npm --prefix server run test:smoke
```

The smoke test runs 58 end-to-end checks against a running server — auth, CSRF, cross-origin
rejection, quick-capture parsing, recurrence materialisation, scoring, analytics, backups, path
traversal, lock/unlock and the full 2FA flow. Run it against a scratch database.

```bash
npm run db:studio
```

Opens Prisma Studio to inspect the database directly.

---

## How the productivity score works

The score is only worth trusting if it can explain itself, so every component reports what it
measured and what it was worth:

| Component | Weight | Measures |
| --- | --- | --- |
| Task completion | 30 | Completed tasks, weighted by priority (urgent 4× … low 1×) |
| Important work | 20 | Share of urgent/high-priority tasks finished |
| Reliability | 12 | Penalty for missed tasks and repeated postponements |
| Habits | 15 | Daily habits kept |
| Focus time | 15 | Tracked focus minutes against your own daily target |
| Consistency | 8 | Current streak, saturating at 14 days |

Components that do not apply to a given day — no tasks planned, no habits set up yet — are
**excluded**, and the remaining weights are rescaled to 100. A genuine rest day never reads as a
failure for something you never committed to. Habits created today do not retroactively penalise
older days.

Tap *Why this score?* on the dashboard for the full breakdown of any day.

---

## Troubleshooting

**Cannot sign in from my phone — the login just reloads.**
Session cookies are `Secure` and browsers drop them over plain HTTP. Set
`ALLOW_INSECURE_COOKIE=true`, or [turn on HTTPS](#turning-on-https).

**"Account locked, try again in N minutes".**
Seven failed attempts triggers a lockout. Wait it out, or clear it:
`npm run reset-admin -- --clear-lockout`.

**Notifications never appear.**
Three things must all be true: notifications allowed in the browser, the master switch on under
Settings → Notifications, and TarangOS open in a tab or installed as an app. Use **Send a test
notification** to isolate which one is missing. Because everything is local, there is no push
server to wake it when every window is closed — see [Daily notifications](#daily-notifications).

**The 10:00 agenda did not arrive.**
If the app was closed at 10:00 it arrives when you next open it, but only within 6 hours. Opening
at 17:00 skips that day by design. Check the time and toggle under Settings → Notifications →
Daily schedule, and confirm your timezone under Settings → Profile — "10:00" means 10:00 where
you are, not on the server clock.

**The app says it is locked every time I come back.**
That is the inactivity auto-lock. Raise `AUTO_LOCK_MINUTES`, or set a quick PIN so unlocking is
four taps instead of a full password.

**Recurring tasks are not appearing in Upcoming.**
Occurrences are generated 30 days ahead whenever the dashboard loads and every 15 minutes by the
scheduler. Force it from Settings, or restart the server.

**Vercel build fails with `P1001: Can't reach database server at host:5432`.**
The connection string is still the placeholder from `.env.example` — note the host is literally
`host`. Create a real database (Storage → Create Database → Neon is quickest) and redeploy.
Newer builds catch this before Prisma runs and say so directly.

**Vercel build fails with "Environment variable not found: DATABASE_URL".**
The build runs migrations, so the database variables must exist at build time as well as
runtime. Make sure they are set for the Production environment, then redeploy.

**Vercel deploy succeeds but every request 500s.**
Check the function logs. The two usual causes are missing `ENCRYPTION_KEY`/`SESSION_PEPPER`
(TarangOS refuses to start without them on serverless, and says so), or a `DATABASE_URL` your
database rejects — most providers require `?sslmode=require`.

**Signed out at random on Vercel.**
`SESSION_PEPPER` is not set, or changed between deploys. It is mixed into your password hash,
so it must be a fixed environment variable that never changes.

**"Too many connections" from the database.**
Use the *pooled* connection string for `DATABASE_URL`. On Neon that is the `-pooler` host; on
Supabase it is the connection-pooling port. Keep the direct one for `DIRECT_URL` only.

**Port 4517 is already in use.**
Set `PORT` to something else, and update the compose port mapping to match.

**I want to move to a new machine.**
Copy the whole `data/` folder across, or use Settings → Data & backups → *Full export (JSON)* and
restore it on the new machine with *replace*.

---

## Licence

Private, personal software. Do what you like with your own copy.
