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
  session is assigned to (`session.gatewayUrl`).
- `app/api/sessions/[id]/plugins*` -- user-facing plugin config CRUD.
- `app/api/internal/sessions/[id]/plugins`, `.../messages` -- **not**
  user-authenticated (no browser session exists in that context); gated by
  a shared secret header (`x-internal-secret` must match
  `INTERNAL_API_SECRET`). Called by the Python plugin engine to fetch
  config+history and to append chat messages.
- `lib/prisma.ts` -- singleton Prisma client.
- `lib/auth.ts` -- NextAuth config (credentials provider, JWT callbacks
  adding `user.id`).
- `lib/session.ts` -- `requireUserId()` helper for API routes.
- `lib/gateway.ts` -- typed HTTP client for gateway instances. Every
  function takes the target gateway's URL explicitly (no implicit single
  gateway) -- always pass `session.gatewayUrl`.
- `lib/shards.ts` -- `pickShardForNewSession()`, reads
  `GATEWAY_SHARD_URLS` (comma-separated, falls back to `GATEWAY_URL`).
- `lib/plugins.ts` -- the plugin registry: keys, display metadata, default
  settings. Add a new plugin here to give it a card on the dashboard.
- `lib/personalities.ts` -- loads `../../personalities.json` (repo root,
  shared with the Python engine) and groups it by category for the AI
  Reply/AI Write dropdowns.
- `components/plugins/*` -- one settings component per plugin
  (`AutoReplySettings`, `AIReplySettings`, `AIWriteSettings`), plus the
  shared `PluginCard` (toggle + expand) and `ExceptionsEditor` (per-contact
  override list, used by both Auto Reply and AI Reply).

## Database

Prisma manages the `public` schema of the shared Aiven Postgres instance.
Models: `User`, `WaSession` (includes `gatewayUrl` for shard routing),
`SessionPlugin` (per-session plugin config, `settings` is a JSON string),
`ChatMessage` (per-session, per-contact history).

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
- `GATEWAY_SHARD_URLS` -- optional, comma-separated, for multiple gateway
  instances (see `lib/shards.ts`).
- `INTERNAL_API_SECRET` -- must match `plugins/.env`'s value exactly.
