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
  plugin settings page.
- `app/api/sessions/*` -- user-facing, auth-checked (via
  `lib/session.ts`'s `requireUserId()`) session CRUD + pair/status/
  disconnect/reconnect, all proxying to whichever gateway instance the
  session is assigned to (`session.gatewayUrl`). `POST` rejects pairing a
  phone number that's already paired in another non-disconnected session
  (409) -- two live gateway connections for the same WhatsApp account
  corrupts its Signal session.
- `app/api/sessions/[id]/plugins*` -- user-facing plugin config CRUD.
- `app/api/internal/sessions/[id]/plugins`, `.../messages` -- **not**
  user-authenticated (no browser session exists in that context); gated by
  a shared secret header (`x-internal-secret` must match
  `INTERNAL_API_SECRET`). Called by the Python plugin engine to fetch
  config+history and to append chat messages.
- `app/api/internal/gateway-sessions` -- same shared-secret gating.
  Called by a gateway instance on startup (`?gatewayUrl=<its own URL>`) to
  find out which sessions it used to hold before the process restarted, so
  it can reconnect them automatically instead of sitting dead until
  someone clicks "Reconnect."
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
- `lib/plugins.ts` -- the plugin registry: keys, display metadata, default
  settings. Add a new plugin here to give it a card on the dashboard.
- `lib/personalities.ts` -- loads `../../personalities.json` (repo root,
  shared with the Python engine) and groups it by category for the AI
  Reply/AI Write dropdowns.
- `components/plugins/*` -- one settings component per plugin
  (`AutoReplySettings`, `AIReplySettings`, `AIWriteSettings`), plus the
  shared `PluginCard` (toggle + expand) and `ExceptionsEditor` (per-contact
  override list, used by both Auto Reply and AI Reply).
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
removing a shard never affects sessions already assigned to it).

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
