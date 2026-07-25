# gateway/

Node.js + Express + [Baileys](https://github.com/WhiskeySockets/Baileys)
(`@whiskeysockets/baileys`). Holds the actual WhatsApp WebSocket connection
for every paired session, in-memory, in a single process (`sessions: Map`
in `whatsappManager.js`).

## Files

- `src/index.js` -- Express routes: `POST /session/:userId/pair`,
  `GET /session/:userId/status`, `POST /session/:userId/logout`,
  `POST /session/:userId/reconnect`, `GET /health` (used by Render's
  health check and the UptimeRobot monitor). On startup, also asks the web
  app (via `webClient.js`) which sessions belong to this instance and
  reconnects each one -- see "Startup reconnect" below -- and starts the
  scheduled-task poller (see "Scheduled tasks" below).
- `src/webClient.js` -- every call this service makes to the web app's
  internal API (everything else is the other direction: web calls
  gateway): `fetchSessionsForGateway`, plus `createScheduledTask`/
  `fetchDueTasks`/`completeScheduledTask` for the scheduler.
- `src/scheduler.js` -- the generic scheduled-task poller, see "Scheduled
  tasks" below.
- `src/whatsappManager.js` -- the core: `startSession`, `reconnectSession`,
  `logoutSession`, `sessionStatus`. Handles pairing-code flow, auto-reconnect
  on transient disconnects (with capped exponential backoff -- see
  "Baileys gotchas" below), the `messages.upsert` handler that routes
  incoming messages to the plugin engine (`/message`) and the owner's own
  outgoing messages to the rewrite flow (`/rewrite`), and LID-to-phone-number
  resolution (see "LID resolution" below).
- `src/postgresAuthState.js` -- Postgres-backed replacement for Baileys'
  own `useMultiFileAuthState`. Same shape, same `BufferJSON` serialization,
  just a DB table instead of local files, so credentials survive the
  process/disk being thrown away. Lives in its own `gateway` Postgres
  schema -- see "Database" below for why that matters.
- `src/pluginClient.js` -- HTTP client for the plugin engine
  (`forwardMessage`, `forwardOwnMessage`, `fetchExceptionNumbers` -- the
  phone numbers this session has exceptions configured for, used for LID
  resolution).

## Database

Uses `DATABASE_URL` (same Postgres instance as `web/`, different schema).
The `gateway` schema holds one table:

```sql
gateway.gateway_auth_state (session_id TEXT, key TEXT, value TEXT, PRIMARY KEY (session_id, key))
```

`key` is either `'creds'` or `'<category>-<id>'` (Baileys' own key/session
naming), `value` is the `BufferJSON`-serialized data.

**Why a separate schema**: `web/`'s Prisma migrations manage the `public`
schema and will try to *drop* any table there they don't recognize. This
table used to live in `public` and Prisma's `db push` tried to delete it
(with live session credentials in it) the first time a schema change ran.
Moving it to its own `gateway` schema (`CREATE SCHEMA IF NOT EXISTS
gateway`, done automatically on first connection) makes Prisma ignore it
entirely. If you ever add more gateway-side persistent state, put it in
the `gateway` schema too.

**SSL note**: newer `pg-connection-string` versions treat a
`sslmode=require` query param as an alias for strict `verify-full`
certificate validation, which fails against Aiven's certs. The connection
string has that param stripped before being passed to `pg.Pool`, with an
explicit `ssl: { rejectUnauthorized: false }` instead. Copy this pattern
if you add more raw `pg` usage anywhere.

## Reconnect watchdog

The in-memory `sessions` Map starts empty every time this process starts
-- a Render redeploy, a crash, anything -- and nothing else automatically
tells previously-live sessions to come back; the dashboard would just sit
there showing "Reconnect" until someone clicked it. Fixed: the gateway
asks the web app's `GET /api/internal/gateway-sessions?gatewayUrl=...`
for every session assigned to `PUBLIC_URL` that isn't explicitly
disconnected, then calls `reconnectSession()` on each -- same logic the
dashboard's manual "Reconnect" button uses (tries saved creds first, only
needs a human if those no longer work, e.g. the device was actually
unlinked from the phone).

This runs once immediately on `app.listen`, **and then on a 2-minute
interval for the life of the process** -- a single startup attempt isn't
enough on its own (e.g. the web app might not be reachable yet during a
simultaneous multi-service deploy, or a session can go stale mid-lifetime
in a way the close-handler's own backoff doesn't catch). `reconnectSession()`
is already a safe no-op for anything already connected, so the recurring
call costs nothing for sessions that are fine.

Requires three env vars this service didn't need before: `PUBLIC_URL`
(this instance's own URL -- must match its `gatewayUrl` on sessions
exactly), `WEB_APP_URL`, and `INTERNAL_API_SECRET` (must match `web/.env`
and `plugins/.env`).

## Humanlike sending

`messages.upsert` also reads `quote`/`parts` off the plugin engine's
response (see `plugins/README.md`'s "Humanlikeness" -- `ai_reply.py`
decides the strategy, this just executes it): a `parts` array sends each
string as its own message with a short randomized gap in between instead
of one plain send (each still gets its own typing-indicator cycle if
`showTyping` is on); `quote` passes `{ quoted: msg }` (the original
incoming message) as `sock.sendMessage`'s options on the first part only,
producing WhatsApp's swipe-reply instead of a plain new message.

## Blocking contacts

AI Reply can signal that a contact should be blocked (opt-in per session
via `allowBlocking` -- see `plugins/README.md`). `messages.upsert` reads
`block`/`blockDurationHours` off the plugin engine's response and calls
`sock.updateBlockStatus(msg.key.remoteJid, 'block')` -- the real WhatsApp-
addressing JID, not the LID-resolved one used for plugin-engine lookups.
A nonzero `blockDurationHours` also creates a `ScheduledTask` (see below)
to automatically unblock later; `0` means permanent.

## Scheduled tasks

A generic, persisted "run this at/after a given time" system
(`ScheduledTask` in `web/prisma/schema.prisma`) -- built for temporary
blocks, but reusable for any future timed feature by picking a new `type`
string and registering a handler in `scheduler.js`, no schema change
needed. Because the gateway's own state is purely in-memory and doesn't
survive a restart, the actual schedule lives in Postgres (via web's
internal API) and gets polled, not kept in memory here.

`scheduler.js` runs a `setInterval` poll (60s) started once at process
startup: fetches this instance's due, incomplete tasks
(`GET /api/internal/scheduled-tasks?gatewayUrl=...`), looks up a handler
by `type`, and only executes it if the task's session is currently
`connected` on this process -- if not (e.g. the gateway just restarted and
hasn't reconnected yet), it's left incomplete and retried next tick rather
than erroring or giving up.

## Multi-instance / sharding

The gateway itself doesn't know or care about sharding -- it just holds
whatever sessions it's told to. The web app decides which gateway instance
a session belongs to (`WaSession.gatewayUrl`, see `web/lib/shards.ts`) and
always talks to that specific instance. To add a second gateway instance:
run another copy of this service somewhere, then register its URL from
the website's admin panel (`/dashboard/admin/shards`, restricted to
`ADMIN_EMAILS`) -- new sessions start being assigned to it immediately,
no redeploy needed. `GATEWAY_SHARD_URLS` in `web/.env` still works too, as
a fallback used only when no shards are registered in the admin panel.

## LID resolution

WhatsApp sometimes addresses a contact by an opaque numeric "LID" (e.g.
`8298212384985@lid`) instead of their phone number in
`msg.key.remoteJid`. Per-contact plugin settings (exceptions) are
configured by phone number, so a message arriving addressed by LID would
silently never match its own exception.

Fixed by asking WhatsApp directly, rather than trying to reverse a LID
back to a number (WhatsApp's contacts.upsert/update events rarely carry
that mapping in practice): on connect, and every 5 minutes after, each
session calls the plugin engine's `GET /session/{id}/exception-numbers` to
get every phone number it has an exception configured for, then calls
`sock.onWhatsApp(...)` on each to get that number's LID, and caches the
`LID -> phone-number JID` mapping (`lidToPhoneJid` in
`whatsappManager.js`). Incoming messages get resolved through that map
before being handed to the plugin engine -- `msg.key.remoteJid` itself is
left untouched for actual sends (WhatsApp still expects the original
addressing there), only the identifier passed to `forwardMessage`/
`forwardOwnMessage` (used for exception matching and chat history) is
resolved.

Limitation: a number only resolves once *something* on this session has
an exception configured for it. There's no bulk/proactive resolution of
every contact the account has ever talked to.

## Baileys gotchas worth remembering

- **Pairing code timing**: `sock.requestPairingCode()` must only be called
  after `connection.update` fires with `qr` present -- calling it
  immediately after `makeWASocket()` races the handshake and WhatsApp
  silently rejects the whole link. See the `pairingRequested` logic in
  `startSession`.
- **Browser fingerprint**: `Browsers.ubuntu` (Baileys' default) gets
  flagged by WhatsApp's anti-automation system (`401` failures with
  reason codes like `frc`/`rva`). Using `Browsers.windows('Chrome')`
  instead.
- **Don't parallelize pairing attempts**: retrying while one is already in
  flight must reuse the existing socket (`PAIRING_ATTEMPT_TTL_MS` logic),
  not open a second one -- two simultaneous unregistered connections for
  the same number gets the link rejected.
- **`getMessage` callback**: required in `makeWASocket()` config so
  WhatsApp's retry-receipt mechanism works. Without it, when a recipient
  fails to decrypt a message and asks for a resend, Baileys has nothing to
  resend, and the recipient is stuck showing "Waiting for this message"
  indefinitely. Implemented via an in-memory `sentMessages` cache (capped
  at 200 entries) per session.
- **Signal session corruption**: heavy pairing/reconnect churn on the same
  account (e.g. during active development) can corrupt the per-contact
  Signal double-ratchet session, showing as `Bad MAC` / `MessageCounterError`
  in logs -- those contacts' messages fail to decrypt entirely and never
  reach the plugin engine. Fix is a clean disconnect (wipes stored creds)
  + fresh pairing code, not something to debug further when it happens.
  The worst version of this -- two live gateway connections for the same
  real WhatsApp number at once -- is now blocked at the source: `web/`'s
  `POST /api/sessions` rejects pairing a number that's already paired in
  another non-disconnected session.
- **Auto-reconnect backoff**: if the automatic reconnect after a dropped
  connection fails outright (e.g. a transient DNS/network blip reaching
  Postgres for stored creds), it retries with capped exponential backoff
  (5s, 10s, 20s, ... up to a 5 min cap) indefinitely rather than giving up
  after one attempt -- `scheduleReconnect()` in `whatsappManager.js`. It
  checks against explicit disconnects (`logoutSession`) so a retry that
  was already scheduled when someone hits "Disconnect" doesn't turn
  around and open an unwanted fresh pairing attempt.

## Windows dev quirk

`node --watch` occasionally loses a restart race and dies with
`EADDRINUSE`, leaving the gateway silently down ("Waiting for file
changes..."). After any code change, verify with:

```powershell
Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue
```

If nothing's listening, kill whatever's on port 4000 and run
`npm run dev` again.
