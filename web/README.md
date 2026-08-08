# web/

Next.js 14 (App Router, TypeScript), Tailwind CSS, Prisma (Postgres),
NextAuth (credentials provider, JWT sessions). Owner-facing pairing
website: accounts, a dashboard of WhatsApp sessions, per-session plugin
configuration.

## Structure

- `app/login`, `app/register` -- auth pages (client components, call
  NextAuth's `signIn` / `POST /api/register`).
- `app/dashboard` -- protected (see `middleware.ts`). `page.tsx` lists the
  user's sessions; `sessions/[id]/plugins/page.tsx` is the per-session
  plugin settings page -- a responsive icon grid (mod-menu style, big
  emoji per plugin), click a tile to open its settings in a modal.
- `app/api/sessions/*` -- user-facing, auth-checked (via
  `lib/session.ts`'s `requireUserId()`) session CRUD + pair/status/
  disconnect/reconnect, all proxying to whichever gateway instance the
  session is assigned to (`session.gatewayUrl`). `POST` rejects pairing a
  phone number that's already paired in another non-disconnected session
  (409) -- two live gateway connections for the same WhatsApp account
  corrupts its Signal session.
- `app/api/sessions/[id]/plugins*` -- user-facing plugin config CRUD.
- `app/api/sessions/[id]/stickers`, `.../[stickerId]` -- user-facing
  sticker list (with base64 thumbnails) and delete-by-id. Delete targets a
  specific sticker's own id, not its tag, since multiple stickers can
  share a tag on purpose.
- `app/api/sessions/[id]/notes`, `.../[noteId]` -- user-facing note list
  and delete.
- `app/api/internal/sessions/[id]/plugins`, `.../messages` -- **not**
  user-authenticated (no browser session exists in that context); gated by
  a shared secret header (`x-internal-secret` must match
  `INTERNAL_API_SECRET`). Called by the Python plugin engine to fetch
  config+history (also piggybacks the session's saved sticker tags and
  `isAdmin` -- whether the session's owning account's email is in
  `ADMIN_EMAILS`, used to gate the owner-only "!status all" command), and
  to append chat messages. Also called directly by the **gateway** itself
  (not just the plugin engine) -- on every message, TTL-cached -- for
  every gateway-only feature that has no Python involvement at all
  (Anti-Delete, Notes, Session Info, Scheduled Messages, Animations,
  Agent) to read their own enabled/settings.
- `app/api/internal/gateway-sessions` -- same shared-secret gating.
  Called by a gateway instance on startup (`?gatewayUrl=<its own URL>`) to
  find out which sessions it used to hold before the process restarted, so
  it can reconnect them automatically instead of sitting dead until
  someone clicks "Reconnect."
- `app/api/internal/scheduled-tasks`, `.../[id]/complete` -- same
  shared-secret gating. The generic persisted-scheduler API (create a
  task, fetch a gateway's own due/incomplete tasks, mark one complete) --
  see `gateway/README.md`'s "Scheduled tasks."
- `app/api/internal/scheduled-tasks/pending`, `.../cancel` -- same gating.
  Backs "!sm list"/"!sm cancel" -- `pending` extracts only the summary
  fields it needs at the SQL level (never the payload's raw `data`, which
  for a scheduled photo/document is its whole file as base64) so listing
  can't pull megabytes into memory just to print a numbered list; `cancel`
  marks one task completed by id, scoped to `sessionId` + `type` so a
  stale id reliably 404s instead of matching something else.
- `app/api/internal/scheduled-tasks/cancel-timer` -- same gating, same
  idea, for the other kind of pending scheduled task: a long "!timer"
  (past WhatsApp's ~15 minute edit window) waiting to fire, matched by the
  id of the confirmation message the owner replied "!stop" to.
- `app/api/internal/shards-summary` -- same gating. Backs the owner-only
  "!status all" WhatsApp command (admins only, checked via the `isAdmin`
  flag piggybacked onto the plugins-fetch response above) -- every
  registered shard's session count and plugin-engine pairing, for an
  admin who wants that from chat instead of the dashboard.
- `app/api/internal/stickers`, `.../[sessionId]/[tag]` -- same
  shared-secret gating. `POST` always inserts a new row (multiple
  stickers can share a tag on purpose -- see the `Sticker` model below);
  `GET` picks a random match among all stickers under that tag.
- `app/api/internal/notes`, `.../[sessionId]/[name]` -- same
  shared-secret gating. `POST` upserts by `(sessionId, name)` (re-saving a
  name overwrites, unlike stickers); `GET` fetches one note for recall.
- `app/api/admin/sessions/*`, `app/api/admin/shards/*` -- admin-only (see
  "Admin panel" below), gated by `lib/admin.ts`'s `requireAdmin()` (a
  logged-in user *and* their email in `ADMIN_EMAILS`), not the internal
  shared-secret pattern above.
- `app/api/health` -- plain unauthenticated `{status:'ok'}`, outside
  `middleware.ts`'s matcher on purpose. Used by Render's health check and
  the UptimeRobot monitor -- `/` would otherwise redirect unauthenticated
  requests to `/login` (a 302 a naive health checker doesn't like).
- `lib/prisma.ts` -- singleton Prisma client.
- `lib/auth.ts` -- NextAuth config (credentials provider, JWT callbacks
  adding `user.id`).
- `lib/session.ts` -- `requireUserId()` helper for API routes.
- `lib/admin.ts` -- `isAdminEmail()` / `requireAdmin()`, checked against
  the `ADMIN_EMAILS` env var (comma-separated allowlist; redeploy needed
  to change). Same pattern as `requireUserId()`, layered with an extra
  check.
- `lib/adminSessions.ts` -- `listSessionsWithStatus()`, shared by the
  all-sessions and per-shard-sessions admin routes: refreshes live status
  from each session's gateway and joins in the shard's label by matching
  `gatewayUrl`.
- `lib/fruitNames.ts` -- picks the next unused fruit name (apple, apricot,
  ...) for a shard created without an explicit label.
- `lib/gateway.ts` -- typed HTTP client for gateway instances. Every
  function takes the target gateway's URL explicitly (no implicit single
  gateway) -- always pass `session.gatewayUrl`.
- `lib/shards.ts` -- `pickShardForNewSession()` (async), prefers active
  rows from the admin-managed `GatewayShard` table, falling back to
  `GATEWAY_SHARD_URLS`/`GATEWAY_URL` whenever there are zero active DB
  rows.
- `lib/plugins.ts` -- the plugin registry: keys, display metadata
  (including an emoji `icon` for the dashboard grid -- kept unique per
  plugin so the icon grid stays scannable), default settings, and which
  plugins a brand-new session starts with switched on
  (`isDefaultEnabled`). 26 keys as of this writing -- growing steadily, so
  treat that number as stale; this file itself is the actual source of
  truth. Add a new plugin here to give it a tile. Most keys are backed by
  a Python plugin (see `plugins/README.md`); several are gateway-only
  (`anti_delete`, `notes`, `session_status`, `scheduled_send`,
  `emoji_animate`, `agent`) with no Python involvement at all -- just a
  settings row the gateway reads directly.
- `lib/personalities.ts` -- loads `../../personalities.json` (repo root,
  shared with the Python engine) and groups it by category for the AI
  Reply/AI Write dropdowns.
- `lib/useSaveState.ts` -- the saving/saved/auto-clear state every plugin
  settings component's Save button needs, shared rather than copy-pasted
  (it used to be, in all 16+ of them). Pairs with
  `components/SaveButton.tsx`.
- `components/plugins/*` -- one settings component per plugin key that
  needs one (several trivial/no-config plugins share a common "usage
  info only" shape and skip straight to a `<div>` of instructions -- see
  `TagAllSettings.tsx` for the simplest example). Notable ones beyond the
  per-plugin settings: `ExceptionsEditor` (per-contact override list, used
  by Auto Reply and AI Reply), `StickerManager` (view/delete saved
  stickers, embedded in `AIReplySettings`), `NotesManager` (view/delete
  saved notes, embedded in `NotesSettings`), and `AgentSettings` /
  `ScheduledSendSettings` (usage examples + the safety notes for `!ag` and
  the timezone picker for `!sm`, respectively).
- `components/plugins/PluginCard.tsx` -- a grid tile (big emoji icon, name,
  enable toggle) rather than the old inline-expanding list item; clicking
  it opens the plugin's settings component in a modal.
- `components/DashboardHeader.tsx` -- the dashboard's nav bar, collapsing
  into a hamburger menu below the `sm` breakpoint (verified in-browser at
  375px: no horizontal overflow, menu opens/closes correctly) instead of
  cramming logo/nav/email/sign-out into one row regardless of screen size.
- `components/ConfirmModal.tsx` -- in-app confirmation dialog (title,
  message, confirm/cancel), used wherever a destructive action needs
  confirmation. Deliberately not the browser's native `confirm()` -- that
  can be silently suppressed by some browser configurations, which used
  to make the dashboard's "Remove" button look like it did nothing.
- `components/admin/*` -- `ShardsManager` and `AdminSessionsManager`
  (client components for the admin panel pages), following the same
  fetch-on-mount + optimistic-refetch pattern as the regular dashboard's
  `SessionCard`/`AddSessionModal`.

## Admin panel

`/dashboard/admin`, gated by `lib/admin.ts`'s `requireAdmin()` at both the
page level (`notFound()` if not admin -- a 404, not a redirect, since the
user IS logged in and a redirect would leak that the route exists) and the
API level (every `app/api/admin/*` route checks independently; the nav
link's visibility is UX only, not the security boundary). Two sections:

- **Sessions** (`/dashboard/admin/sessions`) -- every `WaSession` across
  every `User`, not just the admin's own, with the owner's email and
  shard label joined in (`lib/adminSessions.ts`). Same
  disconnect/reconnect/remove actions as the regular dashboard, just
  without the ownership check.
- **Shards** (`/dashboard/admin/shards`) -- CRUD over the `GatewayShard`
  table. Click a shard to see its sessions
  (`/dashboard/admin/shards/[id]`, reuses `AdminSessionsManager` with a
  scoped `apiUrl`). The env-var-derived fallback shard is also shown
  (marked "In effect" or "Standing by") with a one-click "Manage as a
  shard" button that promotes it into a real DB row.

## Database

Prisma manages the `public` schema of the shared Aiven Postgres instance.
Models: `User`, `WaSession` (includes `gatewayUrl` for shard routing),
`SessionPlugin` (per-session plugin config, `settings` is a JSON string),
`ChatMessage` (per-session, per-contact history), `GatewayShard`
(admin-managed pool of gateway instances -- deliberately no relation to
`WaSession`; it's a lookup table read once at session-creation time, so
removing a shard never affects sessions already assigned to it),
`ScheduledTask` (generic persisted "run this typed action at/after a
given time" -- currently used for temporary contact unblocks, reusable
for future timed features; see `gateway/README.md`'s "Scheduled tasks"),
`Sticker` (`data` is `Bytes`/`bytea` -- WhatsApp stickers are tiny `.webp`
files, no object storage needed at this scale; **no** unique constraint on
`(sessionId, tag)` -- multiple stickers can share a tag on purpose, a
random one gets picked at send time), `Note` (unique on
`(sessionId, name)` -- unlike stickers, re-saving a name overwrites; also
stores media as `Bytes` when `kind` is `'media'`).

**Do not run `prisma db push --accept-data-loss`** without reading exactly
what it says it will drop first -- the `gateway` schema (a different
schema, holding live WhatsApp credentials) is deliberately outside
Prisma's management, but a careless `--accept-data-loss` on a schema
mismatch has destroyed data before. See `gateway/README.md` for why that
separation exists.

**Windows dev note**: a running `next dev` process locks the Prisma query
engine DLL -- stop the web server before running `prisma migrate dev` or
`prisma db push`, then start it again after.

## Auth model

Email/password only (bcrypt hash, NextAuth JWT sessions -- no DB-backed
session table needed). `middleware.ts` redirects unauthenticated users
away from `/dashboard/*` to `/login`, and authenticated users away from
`/login`/`/register` to `/dashboard`.

## Env vars (`.env`)

- `DATABASE_URL` -- Aiven Postgres connection string (already configured).
- `NEXTAUTH_SECRET`, `NEXTAUTH_URL` -- already configured (dev-only secret
  value; generate a real one before any public deploy).
- `GATEWAY_URL` -- default/fallback gateway instance.
- `GATEWAY_SHARD_URLS` -- optional, comma-separated, fallback for multiple
  gateway instances when nothing's registered in `/dashboard/admin/shards`
  (see `lib/shards.ts`).
- `INTERNAL_API_SECRET` -- must match `plugins/.env`'s value exactly.
- `ADMIN_EMAILS` -- comma-separated allowlist for `/dashboard/admin/*`.
  Redeploy needed to change.
