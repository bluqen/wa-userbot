# gateway/

Node.js + Express + [Baileys](https://github.com/WhiskeySockets/Baileys)
(`@whiskeysockets/baileys`). Holds the actual WhatsApp WebSocket connection
for every paired session, in-memory, in a single process (`sessions: Map`
in `whatsappManager.js`).

## Files

- `src/index.js` -- Express routes: `POST /session/:userId/pair`,
  `GET /session/:userId/status`, `POST /session/:userId/logout`,
  `POST /session/:userId/reconnect`.
- `src/whatsappManager.js` -- the core: `startSession`, `reconnectSession`,
  `logoutSession`, `sessionStatus`. Handles pairing-code flow, auto-reconnect
  on transient disconnects, and the `messages.upsert` handler that routes
  incoming messages to the plugin engine (`/message`) and the owner's own
  outgoing messages to the rewrite flow (`/rewrite`).
- `src/postgresAuthState.js` -- Postgres-backed replacement for Baileys'
  own `useMultiFileAuthState`. Same shape, same `BufferJSON` serialization,
  just a DB table instead of local files, so credentials survive the
  process/disk being thrown away. Lives in its own `gateway` Postgres
  schema -- see "Database" below for why that matters.
- `src/pluginClient.js` -- HTTP client for the plugin engine
  (`forwardMessage`, `forwardOwnMessage`).

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

## Multi-instance / sharding

The gateway itself doesn't know or care about sharding -- it just holds
whatever sessions it's told to. The web app decides which gateway instance
a session belongs to (`WaSession.gatewayUrl`, see `web/lib/shards.ts`) and
always talks to that specific instance. To add a second gateway instance:
run another copy of this service somewhere, add its URL to
`GATEWAY_SHARD_URLS` in `web/.env`, done -- new sessions will start being
assigned to it.

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

## Windows dev quirk

`node --watch` occasionally loses a restart race and dies with
`EADDRINUSE`, leaving the gateway silently down ("Waiting for file
changes..."). After any code change, verify with:

```powershell
Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue
```

If nothing's listening, kill whatever's on port 4000 and run
`npm run dev` again.
