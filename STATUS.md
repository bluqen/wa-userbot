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

## What's built (all working, tested live)

- **Pairing website** (`web/`) -- Next.js, email/password accounts (NextAuth),
  a dashboard listing each user's WhatsApp sessions, add/reconnect/disconnect
  flows, all backed by Postgres (Aiven, free tier).
- **Gateway** (`gateway/`) -- Node.js + Baileys, holds the actual WhatsApp
  socket(s). WhatsApp session credentials are stored in Postgres (not local
  files), so they survive the gateway process/disk being thrown away and
  restarted -- verified working.
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
- **Shard-aware routing** -- sessions record which gateway instance they
  live on (`WaSession.gatewayUrl`), picked from `GATEWAY_SHARD_URLS` (currently
  just one shard). Adding a second gateway instance later is just adding a
  URL to that env var -- no code changes needed.
- **Chat history** -- every message (both sides) is logged to Postgres per
  (session, contact), pruned to the most recent 50. AI Reply pulls up to
  its configured window (default 10) for multi-turn context.

## What's configured and already working (don't redo signup steps)

- **Aiven Postgres** -- free tier, no card, connection string already set as
  `DATABASE_URL` in both `gateway/.env` and `web/.env` (same database, two
  schemas -- see "Important gotchas" below).
- **Groq API key** -- already in `plugins/.env` as `GROQ_API_KEY`, working.
- **Gemini API key** -- already in `plugins/.env` as `GEMINI_API_KEY`, used as
  automatic fallback if Groq fails/hits its daily cap.
- **Test login**: `test2@example.com` / `testpassword123` (created fresh
  after the SQLite->Postgres migration; the account from before that
  migration no longer exists).
- **Paired WhatsApp session**: label "My Number", phone `2349135000629`,
  session id `cmrzbnj0g0004x1xkrzh1vm1t`, gateway url `http://localhost:4000`.
  As of the last check in this conversation it was connected. If it shows
  disconnected, use the dashboard's "Reconnect" button first (tries saved
  creds before falling back to a new pairing code).

## In progress / needs verification (pick up here)

1. **AI Reply exceptions were being debugged when context ran out.** The
   user reported exceptions (excluding a contact, giving another a custom
   style) weren't taking effect. Two real causes were found and fixed along
   the way:
   - A recurring Signal-protocol session corruption ("Bad MAC" /
     "MessageCounterError" in gateway logs) was causing messages from
     specific contacts to fail to *decrypt* entirely -- they never reached
     the plugin logic at all, which looked like "exceptions aren't working"
     but was actually upstream of that. Fixed by a clean disconnect + fresh
     pairing code (this cycle has happened a few times today from heavy
     testing -- see gotcha below).
   - **Still open**: WhatsApp sometimes addresses a contact by an opaque
     numeric "LID" (linked ID, e.g. `17206192644250@lid`) instead of their
     phone number in `msg.key.remoteJid`. The exceptions-matching code in
     `plugin_base.py`'s `resolve_settings()` matches on phone number only --
     if a contact is addressed by LID, phone-number matching will silently
     never match. **This was not yet confirmed as the actual remaining
     bug** -- the immediate next step is to have a real contact message the
     bot again (now that the session has a clean re-pair) and check the
     plugin engine's debug log line `[debug] incoming message from_jid=...`
     (already added to `plugins/app/main.py`) to see what format the JID
     actually arrives in. If it's `@lid`, the fix is either (a) resolving
     LID->phone number via Baileys' internal store before calling the
     plugin engine, or (b) also accepting LID as a match key in the
     exceptions UI.
   - **Important**: my own testing wrote *dummy* exception data (fake
     numbers `999888777` / `444555666`) to this session's AI Reply settings
     to verify the mechanism works in isolation (confirmed: exceptions
     *do* work correctly when the message actually decrypts and reaches
     the plugin -- tested with a fake pirate-personality override and a
     multi-turn memory test, both passed). **This likely overwrote the
     user's real exceptions** (excluding their friend `2348128154459`,
     and a custom emoji/French style for another friend). Those need to be
     re-entered via the dashboard once the LID question above is resolved.

2. **Hosting deployment not started yet.** Plan discussed and agreed:
   Render.com free tier (no card) for gateway + web + plugins, with
   UptimeRobot (free) pinging the gateway to prevent Render's 15-minute
   inactivity spin-down. Aiven Postgres is already the persistent store, so
   the earlier concern about Render's ephemeral disk wiping state is
   already solved -- nothing local is relied on for persistence anymore.
   Not yet done: actual Render account/services, `render.yaml` or manual
   service setup, environment variables on Render, UptimeRobot monitor
   setup, verifying the deployed version actually works end to end.

## Important gotchas discovered today (don't rediscover these the hard way)

- **`node --watch` has a port-race bug** on this Windows setup -- after a
  file-triggered restart it sometimes fails with `EADDRINUSE` and the
  gateway silently stays down ("Waiting for file changes..."). After any
  gateway code change, check `Get-NetTCPConnection -LocalPort 4000` and
  force-restart if nothing's listening.
- **Groq API keys are case-sensitive** -- must start with lowercase `gsk_`.
  A capitalized `Gsk_` (e.g. from a keyboard auto-capitalizing) causes a
  silent 401.
- **Baileys pairing code must be requested only after the `qr` event**
  fires in `connection.update`, never immediately after `makeWASocket()` --
  doing so races the handshake and gets the link silently rejected by
  WhatsApp. Already fixed in `gateway/src/whatsappManager.js`.
- **Baileys' default browser fingerprint** (`Browsers.ubuntu`) gets flagged
  by WhatsApp's anti-automation system. Already using `Browsers.windows('Chrome')`
  instead.
- **Retrying a pairing attempt while one is in flight** must reuse the
  existing socket, not open a second one -- doing so confuses WhatsApp into
  rejecting the whole link. Already handled (session TTL + reuse logic).
- **`getMessage` callback is required** in `makeWASocket()` so WhatsApp's
  retry-receipt mechanism can work -- without it, recipients see "Waiting
  for this message" indefinitely when a message fails to decrypt on their
  end. Already implemented (in-memory `sentMessages` cache, capped at 200).
- **Repeated pairing/disconnecting/reconnecting the same WhatsApp account**
  (which happens a lot during active development) corrupts the Signal
  double-ratchet session for specific contacts, causing their messages to
  fail to decrypt ("Bad MAC" / "MessageCounterError" in gateway logs). The
  fix each time is a full disconnect (wipes stored creds) + fresh pairing
  code. This is expected fallout of heavy testing, not a bug to chase
  further -- just re-pair when it happens.
- **`pg-connection-string`'s newer versions** treat `sslmode=require` in a
  connection string as an alias for strict `verify-full` cert validation,
  which fails against Aiven's certs. `gateway/src/postgresAuthState.js`
  strips `sslmode=...` from the connection string and passes an explicit
  `ssl: { rejectUnauthorized: false }` instead. If you add more raw `pg`
  usage anywhere, copy this pattern.
- **Prisma's `migrate dev`/`db push` try to own the entire `public` schema**
  and will attempt to *drop* tables there that they don't recognize. The
  gateway's own Postgres table (`gateway_auth_state`, holding live WhatsApp
  credentials) was moved into its own `gateway` schema specifically to
  avoid Prisma ever trying to delete it. **Never run
  `prisma db push --accept-data-loss`** without first checking exactly
  what it says it will drop.
- **On Windows, a running `next dev` process locks the Prisma query engine
  DLL** -- always stop the web server before running `prisma migrate` /
  `prisma db push`, then restart it after.
- Services get stopped by environment/session restarts fairly often during
  a long working session -- always check
  `Get-NetTCPConnection -LocalPort 3000,4000,8000` before assuming
  something is still running.

## Quick health check for a fresh session

```powershell
Get-NetTCPConnection -LocalPort 3000,4000,8000 -State Listen -ErrorAction SilentlyContinue
```

If nothing's listening, see "Running everything" in `README.md`.
