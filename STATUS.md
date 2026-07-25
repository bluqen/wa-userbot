# Project Status / Continuation Guide

**Read this file first in a new chat.** It's the "where we left off" snapshot
for the WA Bot project (WhatsApp userbot + pairing website + AI plugins).
See `README.md` for architecture/setup, and `gateway/README.md`,
`plugins/README.md`, `web/README.md` for service-specific detail.

## How to resume in a new chat

Just say something like: *"Read STATUS.md, README.md, and the per-service
READMEs in this project, then let's continue."* Claude will pick up full
context from these files. Don't re-explain the whole project from scratch --
it's all here.

## Deployed and live (Render, free tier)

Each service lives in its **own Render workspace** (not one shared
Blueprint) specifically to get three separate free-tier quotas instead of
one shared one. Deploy config for each is a standalone Blueprint file at
the repo root: `render.gateway.yaml`, `render.plugins.yaml`,
`render.web.yaml` -- point Render's "Blueprint Path" at the relevant file
when setting up each workspace (Render added custom Blueprint paths in Feb
2026; no longer requires a root-level `render.yaml`).

- **Gateway**: `https://wa-bot-gateway.onrender.com`
- **Plugins**: `https://wa-userbot.onrender.com`
- **Web**: `https://wa-userbot-tqw4.onrender.com`

All three cross-wired via env vars (`GATEWAY_URL`, `WEB_APP_URL`,
`PLUGIN_ENGINE_URL` each pointing at the others' real URLs). All three have
UptimeRobot monitors (5 min interval) against their `/health` endpoint
(`/api/health` for web) to fight Render free tier's ~15 min inactivity
spin-down -- this matters most for the gateway (holds the live WhatsApp
socket) and web (plugins' calls to web's internal API have a hard 5s
timeout, so a cold web silently drops replies rather than just delaying
them).

Database is still the same single Aiven Postgres instance used locally --
**local dev and the deployed app share one DB.** Don't run local gateway
dev and expect it to coexist with a session that's actually live on the
deployed gateway; whichever one currently holds the WhatsApp socket for a
given session should be the only one touching it (see "Bad MAC" gotcha
below -- two live connections for the same number is exactly what causes
that corruption).

## What's built (all working, tested live -- locally and on Render)

- **Pairing website** (`web/`) -- Next.js, email/password accounts (NextAuth),
  a dashboard listing each user's WhatsApp sessions, add/reconnect/disconnect
  flows, all backed by Postgres (Aiven, free tier).
- **Gateway** (`gateway/`) -- Node.js + Baileys, holds the actual WhatsApp
  socket(s). WhatsApp session credentials are stored in Postgres (not local
  files), so they survive the gateway process/disk being thrown away and
  restarted -- verified working, including across a real Render redeploy.
- **Plugin engine** (`plugins/`) -- Python + FastAPI, three plugins:
  - **Auto Reply** -- fixed message, group/cooldown controls, per-contact
    exceptions.
  - **AI Reply** -- LLM-generated replies (Groq, falls back to Gemini),
    100 selectable personalities + custom prompt, per-chat memory (last N
    messages), per-contact exceptions (different personality or excluded
    entirely per contact).
  - **AI Write** -- instantly edits the userbot owner's *own* outgoing
    messages (fix typos/grammar, or rewrite tone/translate) via WhatsApp's
    native edit-message feature.
- **Admin panel** (`/dashboard/admin`, `web/`) -- restricted to emails listed
  in `ADMIN_EMAILS` (comma-separated env var; redeploy needed to change).
  Two sections:
  - **Sessions** (`/dashboard/admin/sessions`) -- every WhatsApp session
    across every account (not just the logged-in admin's own), with the
    owner's email and which shard it's on. Disconnect/Reconnect/Remove work
    on any session, admin or not.
  - **Shards** (`/dashboard/admin/shards`) -- the pool of gateway instances
    new sessions get assigned to (`GatewayShard` DB table, admin-managed,
    replacing the old env-var-only `GATEWAY_SHARD_URLS`). New shards
    auto-get a fruit-themed label (apple, apricot, ...) if none is typed
    in. The env-var fallback shard is surfaced in the list too (marked "In
    effect" or "Standing by") so it's never silently invisible. Click a
    shard to drill into the sessions assigned to it. Deleting/deactivating
    a shard row never affects sessions already using it -- `gatewayUrl` is
    a plain string copied onto each session once, at creation time, not a
    live reference to the shard row.
- **Shard-aware routing** -- `pickShardForNewSession()` (`web/lib/shards.ts`)
  prefers active DB-managed shards, falling back to the
  `GATEWAY_URL`/`GATEWAY_SHARD_URLS` env vars whenever there are zero
  active DB rows.
- **Duplicate-pairing guard** -- a phone number can't be paired into a
  second session while another non-disconnected session already holds it
  (409 on `POST /api/sessions`). This is what was causing the worst of the
  "Bad MAC" Signal-session corruption before it was added -- two live
  Baileys connections for the same real WhatsApp account fighting each
  other.
- **Chat history** -- every message (both sides) is logged to Postgres per
  (session, contact), pruned to the most recent 50. AI Reply pulls up to
  its configured window (default 10) for multi-turn context. Both history
  saves in the plugin engine's `/message` handler are fire-and-forget
  (`asyncio.create_task`, not awaited) -- reply generation and delivery no
  longer wait on a round trip to web's internal API just to log history.

## Fixed since the last major session

- **LID vs. phone-number matching (was the main open bug)** -- WhatsApp
  sometimes addresses a contact by an opaque numeric "LID"
  (`8298212384985@lid`) instead of their phone number in
  `msg.key.remoteJid`, which meant per-contact exceptions (configured by
  phone number) silently never matched. Confirmed via live traffic and
  fixed in `gateway/src/whatsappManager.js`: on connect (and every 5 min
  after), the gateway asks WhatsApp directly (`sock.onWhatsApp(...)`) for
  the LID of every phone number this session actually has an exception
  configured for (fetched from the plugin engine's
  `/session/{id}/exception-numbers`), and resolves incoming LIDs back to
  the real phone-number JID before handing the message to the plugin
  engine. Verified live: a French-only exception and a full-exclusion
  exception both now apply correctly to LID-addressed contacts.
- **Gateway auto-reconnect used to give up after one failed attempt** (e.g.
  a transient DNS blip reaching Postgres) -- now retries with capped
  exponential backoff (5s -> 5 min) indefinitely, and tracks explicit
  disconnects so a pending retry doesn't fight a manual "Disconnect" click.
- **Bot-vs-bot reply loops** -- a global circuit breaker
  (`plugins/app/rate_limiter.py`) caps any single contact to 6 auto-replies
  per 60 seconds; past that, replies to that contact pause for 5 minutes.
  Independent of each plugin's own cooldown setting, so it catches a loop
  regardless of which plugin is responding.
- **Dashboard "Remove" button silently doing nothing** -- was relying on
  the browser's native `confirm()` popup, which can be silently suppressed
  by some browser configurations (reproduced this exact failure while
  debugging). Replaced with an in-app `ConfirmModal` component.
- **UptimeRobot showing the plugins service as persistently "down"** --
  its monitor is configured to probe with `HEAD`, and FastAPI's
  `@app.get("/health")` doesn't auto-accept `HEAD` (unlike Express and
  Next.js, which do) -- 405, confirmed via the monitor's own incident log.
  Fixed with `@app.api_route("/health", methods=["GET", "HEAD"])`.

## Known gotchas discovered (don't rediscover these the hard way)

- **`node --watch` has a port-race bug** on this Windows setup -- after a
  file-triggered restart it sometimes fails with `EADDRINUSE` and the
  gateway silently stays down ("Waiting for file changes..."). Workaround
  used throughout this project's development: run the gateway with plain
  `node src/index.js` (no `--watch`) while actively iterating on it, and
  manually restart after each edit.
- **Running `next build` while `next dev` is also running against the same
  `web/` directory corrupts the shared `.next` output** -- the dev server
  starts 500ing on routes it served fine moments before
  (`MODULE_NOT_FOUND` in `.next/server/...`). Fix: stop the dev server,
  `rm -rf web/.next`, restart `next dev` clean. Don't run a production
  build and the dev server against the same directory at the same time.
- **`next build`'s type-checking is stricter than `next dev`'s** -- a real
  type error in `web/lib/admin.ts` (TypeScript couldn't narrow
  `email: string | undefined` to `string` through a boolean-returning
  helper function) only surfaced when Render actually ran `next build` in
  production, not during local `next dev`. Worth running `npm run build`
  locally before pushing anything touching `web/`, not just `next dev`.
- **Render's manual "New Web Service" flow needs the Root Directory set
  explicitly per service** (`gateway`, `plugins`, or `web`) -- if missed,
  the build runs from a default path and fails with `ENOENT` looking for
  `package.json`. Fixable after the fact via the service's Settings tab
  without recreating it.
- **Health Check Path must match the framework's actual route, not just
  copy the pattern from another service** -- gateway and plugins both use
  `/health`, but the Next.js web service's health route is at
  `/api/health` (there's no bare `/health` route on it at all). Setting it
  to `/health` on the web service causes Render to health-check `/`
  instead, which redirects unauthenticated requests to `/login` (a 302
  Render's default checker doesn't like) -- deploy sits in a timeout/retry
  loop and eventually fails.
- **A stray leftover SQLite file existed at `web/prisma/prisma/dev.db`**
  (from before the Postgres migration, at an accidentally-doubled nested
  path) with a real password hash in it, sitting outside what the old
  `.gitignore` pattern actually matched (`prisma/dev.db`, not
  `prisma/prisma/dev.db`). Deleted; `.gitignore` now uses `**/dev.db` to
  not depend on the exact nesting level again.
- **Groq API keys are case-sensitive** -- must start with lowercase `gsk_`.
  A capitalized `Gsk_` (e.g. from a keyboard auto-capitalizing) causes a
  silent 401.
- **Baileys pairing code must be requested only after the `qr` event**
  fires in `connection.update`, never immediately after `makeWASocket()` --
  doing so races the handshake and gets the link silently rejected by
  WhatsApp. Already handled in `gateway/src/whatsappManager.js`.
- **Baileys' default browser fingerprint** (`Browsers.ubuntu`) gets
  flagged by WhatsApp's anti-automation system. Already using
  `Browsers.windows('Chrome')` instead.
- **`getMessage` callback is required** in `makeWASocket()` so WhatsApp's
  retry-receipt mechanism can work -- without it, recipients see "Waiting
  for this message" indefinitely when a message fails to decrypt on their
  end. Already implemented (in-memory `sentMessages` cache, capped at 200).
- **Repeated pairing/disconnecting/reconnecting the same WhatsApp account**
  can still corrupt the Signal double-ratchet session for specific
  contacts even with the duplicate-pairing guard in place (this is
  separate from the two-live-connections case the guard fixes) -- shows as
  `Bad MAC` / `MessageCounterError` in gateway logs for that contact. Fix
  is the same as always: full disconnect (wipes stored creds) + fresh
  pairing code for the affected session.
- **`pg-connection-string`'s newer versions** treat `sslmode=require` in a
  connection string as an alias for strict `verify-full` cert validation,
  which fails against Aiven's certs. `gateway/src/postgresAuthState.js`
  strips `sslmode=...` from the connection string and passes an explicit
  `ssl: { rejectUnauthorized: false }` instead. Copy this pattern if you
  add more raw `pg` usage anywhere.
- **Prisma's `migrate dev`/`db push` try to own the entire `public` schema**
  and will attempt to *drop* tables there that they don't recognize. The
  gateway's own Postgres table (`gateway_auth_state`) lives in its own
  `gateway` schema specifically to avoid this. **Never run
  `prisma db push --accept-data-loss`** without first checking exactly
  what it says it will drop.
- **On Windows, a running `next dev` process locks the Prisma query engine
  DLL** -- always stop the web server before running `prisma migrate` /
  `prisma db push`, then restart it after.
- **This sandboxed dev environment's `Get-Process`/`Stop-Process` can
  report the wrong PID for a process actually holding a port** (seen with
  both Node's `--watch` reloader/worker split and some stale Windows
  socket-table entries) -- `netstat -ano` plus `taskkill //F //PID <real
  pid> //T` is the reliable way to find and kill whatever's actually bound
  to a port when a graceful restart doesn't free it.

## Quick health check for a fresh session

Local:
```powershell
Get-NetTCPConnection -LocalPort 3000,4000,8000 -State Listen -ErrorAction SilentlyContinue
```

Deployed:
```bash
curl https://wa-bot-gateway.onrender.com/health
curl https://wa-userbot.onrender.com/health
curl https://wa-userbot-tqw4.onrender.com/api/health
```

If a local port has nothing listening, see "Running everything" in
`README.md`. If a deployed URL doesn't respond, check that workspace's
Render dashboard for the actual current state before assuming anything's
broken -- Render free tier does spin down without traffic even with
UptimeRobot pinging if the ping itself is failing (check its incident log
for the *specific* error, not just "down").

## Nothing currently in progress

Everything tracked in earlier versions of this file (LID matching, the
Bad MAC duplicate-session issue, hosting deployment) is resolved and
verified live, both locally and on Render. Next steps are whatever the
project owner wants next -- there's no dangling half-finished work to pick
up.
