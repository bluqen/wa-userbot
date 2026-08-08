# WA Bot

A WhatsApp userbot with a website that handles account creation, pairing,
and per-session plugin configuration; a Node.js gateway that holds the
actual WhatsApp connection(s); and a Python plugin engine with AI-powered
reply and message-editing plugins.

**New chat picking this up? Read `STATUS.md` first** -- it has the current
state, what's in progress, and gotchas worth knowing before you touch
anything.

```
web/       Next.js -- accounts, dashboard, pairing UI, plugin settings
gateway/   Node.js + Baileys -- owns the WhatsApp connection(s)
plugins/   Python + FastAPI -- modular reply/rewrite logic
```

Both `web` and `gateway` share one Postgres database (Aiven, free tier):
`web` (via Prisma) owns the `public` schema (users, sessions, plugin
config, chat history); `gateway` owns its own `gateway` schema (WhatsApp
credentials), kept separate so Prisma's migrations never touch it.

## Architecture

```
                         ┌─────────────┐
   Owner's browser  ───► │   web/      │ ───┐
                         │  (Next.js)  │    │ Postgres (Aiven)
                         └─────────────┘    │ public schema:
                                │            │  User, WaSession,
                     REST (session.gatewayUrl)│  SessionPlugin,
                                │            │  ChatMessage
                                ▼            │
                         ┌─────────────┐    │
        WhatsApp  ◄────► │  gateway/   │ ───┘ gateway schema:
                         │  (Baileys)  │        gateway_auth_state
                         └─────────────┘
                                │
                    HTTP /message, /rewrite, /ask, /agent/plan
                                │
                                ▼
                         ┌─────────────┐
                         │  plugins/   │ ──► Groq / Gemini (LLM)
                         │  (FastAPI)  │ ──► web's internal API
                         └─────────────┘      (plugin config, history)
```

Message flow (incoming): WhatsApp -> gateway -> `POST /message` on the
plugin engine -> engine fetches this session's enabled plugins + recent
chat history from the web app (one internal API call) -> first matching
plugin's reply wins -> gateway sends it back, optionally simulating typing
first.

Message flow (owner's own messages): gateway detects `fromMe` messages ->
`POST /rewrite` -> if AI Write is enabled and decides a change is needed,
gateway edits the just-sent message via WhatsApp's native edit feature.

## Prerequisites

- **Node.js 18+**
- **Python 3.10+** (on this dev machine, only available via the `py`
  launcher or `C:\Python314\python.exe` -- plain `python`/`pip` resolve to
  an empty Microsoft Store stub)
- A Postgres database (already set up on Aiven's free tier -- see
  `STATUS.md` for the current connection string location; each service's
  `.env` already has it configured)
- Free API keys for AI Reply/AI Write (already obtained and configured):
  - [Groq](https://console.groq.com/keys) -- primary, fast, generous free
    tier, no card
  - [Gemini](https://aistudio.google.com/apikey) -- automatic fallback if
    Groq fails or hits its daily cap

## Running everything

Each service needs its own terminal (or run in the background).

### 1. Plugin engine

```powershell
cd plugins
py -m venv venv                                    # first time only
.\venv\Scripts\python.exe -m pip install -r requirements.txt   # first time only
.\venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

Check: `http://localhost:8000/health` -> `{"status": "ok"}`

### 2. Gateway

```bash
cd gateway
npm install     # first time only
npm run dev
```

Holds the actual WhatsApp socket(s) -- keep running. Credentials are in
Postgres, not local files, so restarting this process is safe (sessions
reconnect automatically using stored creds).

### 3. Website

```bash
cd web
npm install     # first time only
npm run dev
```

Open `http://localhost:3000`. Register an account (or use the existing
test login noted in `STATUS.md`), add a WhatsApp session, and pair it via
the phone-number + pairing-code flow.

### Env files

Each service has a `.env.example` documenting what it needs; the real
`.env` files already exist with working values for this project (Postgres
connection string, API keys, internal shared secret). Don't commit `.env`
files -- they're gitignored.

## The plugins

All configured per WhatsApp session from the dashboard's Plugins page
(`/dashboard/sessions/[id]/plugins`) -- an icon grid, mod-menu style; click
a tile to open its settings in a modal. The definitive, current list lives
in `web/lib/plugins.ts` -- the dashboard itself reads from it, so it can't
drift out of sync with reality the way a hand-written list here would.
Roughly, by how they work:

- **AI**: Auto Reply, AI Reply (100 personalities, per-contact exceptions,
  humanlikeness slider), AI Write (edits the owner's own outgoing
  messages), AI Ask (`!ai`/`!aie`, one-shot Q&A), **Agent** (`!ag`,
  plain-language instructions turned into a plan of WhatsApp actions --
  see below).
- **Media/fun**: Song Fetcher, Imagine (AI image generation), Pinterest
  (image search), Sticker Maker, QR Codes, the Fun pack (`!8ball`, `!rps`,
  `!trivia`, `!meme`, voice effects), Animations (`..happy` and friends,
  edits the owner's own message into an animated frame sequence).
- **Utility**: Translate, Timers (live countdown under WhatsApp's edit
  window, a scheduled ping past it), Scheduled Messages (`!sm`, reply to
  anything -- text, photo, document, voice note -- to send it later, to a
  contact or a group), Notes (`!savenote`/`#name`), Session Info
  (`!status`), plus `!contacts` and `!help` (always on, no toggle).
- **Groups**: Tag Everyone, Polls, Greetings, Anti-Link.

Every command starts with `!` -- no mixed `/`/`!` convention. Owners can
send `!help` for the live, on/off-annotated command list for that session.

Gateway-only plugins (Anti-Delete, Notes, Session Info, Scheduled
Messages, Animations, Agent, contacts/groups directory) never touch the
Python plugin engine at all -- see `gateway/README.md`.

### The agent (`!ag`)

The most involved plugin: turns a plain-language instruction into a plan
of WhatsApp actions. `!ag tell mum, dad and roger I won't be home soon`
plans three messages, resolves each name against the real contact book,
shows the plan, and only sends once the owner replies `!ag yes`.
Capabilities (message, poll, remind, schedule a message, save a note,
generate a QR code) live in one registry (`gateway/src/agentActions.js`)
that the planner's own prompt is generated from, so it can never ask for
something the gateway can't actually do. The owner's contact list is never
sent to the LLM -- the planner only ever echoes back names the owner
typed; resolving a name to a real person happens locally in the gateway.
See that file's comments for the full design reasoning.

## Admin panel

`/dashboard/admin`, restricted to emails listed in `ADMIN_EMAILS` (comma-
separated env var in `web/.env` -- redeploy needed to change). Two
sections:

- **Sessions** (`/dashboard/admin/sessions`) -- every WhatsApp session
  across every account, not just the logged-in admin's own. Disconnect,
  reconnect, or remove any session; each row shows the owning account's
  email and which shard it's assigned to.
- **Shards** (`/dashboard/admin/shards`) -- the pool of gateway instances
  new sessions get assigned to, backed by a `GatewayShard` table instead
  of a static env var, so it's editable at runtime without a redeploy. New
  shards get an auto-assigned fruit name (apple, apricot, ...) if you
  don't type one in. Click a shard to see the sessions currently assigned
  to it. Each shard can optionally be paired with its own plugin-engine
  instance (`pluginEngineUrl`) -- purely informational on this side (a
  gateway reads its actual `PLUGIN_ENGINE_URL` from its own env var, not
  from this row), so the admin panel can show and catch a mismatch in the
  pairing rather than change runtime behavior itself.

Detailed per-plugin descriptions, defaults, and dashboard copy all live in
`web/lib/plugins.ts` and each plugin's own settings component under
`web/components/plugins/` -- kept there rather than duplicated here so
there's exactly one place to update when a plugin's behavior changes.

## Writing a new reply plugin

Reply-style plugins (respond to incoming messages) live in
`plugins/app/plugins/` and are auto-discovered -- see `plugins/README.md`
for the full guide. Short version:

```python
# plugins/app/plugins/my_plugin.py
from typing import Optional
from ..plugin_base import MessageContext, Plugin, Reply, resolve_settings

class MyPlugin(Plugin):
    name = "my_plugin"    # unique key, referenced from the web dashboard
    priority = 75          # lower runs first; first match wins

    def match(self, ctx: MessageContext) -> bool:
        return "ping" in ctx.text.lower()

    def handle(self, ctx: MessageContext) -> Optional[Reply]:
        return Reply(text="pong")
```

Then add it to `web/lib/plugins.ts` (key, name, description, defaults) so
it gets a card on the dashboard, and build a settings component if it
needs configuration beyond enable/disable.

## Deployment

Deployed to Render (free tier), one service per Render workspace so each
gets its own free-tier quota -- see `render.gateway.yaml`,
`render.plugins.yaml`, `render.web.yaml` at the repo root (each is a
standalone Blueprint file; point Render's Blueprint Path at the relevant
one per workspace). UptimeRobot pings each service's `/health`
(`/api/health` for web) to fight Render's free-tier inactivity spin-down.
Current live URLs and full deployment notes are in `STATUS.md`.

## Known limitations

- A per-contact reply rate limiter (`plugins/app/rate_limiter.py`) guards
  against runaway bot-vs-bot reply loops, but there's still no general
  abuse protection against a real user spamming the bot -- bulk messaging
  risk remains with an unofficial WhatsApp client (Baileys). Keep volume
  reasonable.
- Shard routing supports multiple gateway instances, each optionally
  paired with its own plugin-engine instance (managed from
  `/dashboard/admin/shards`, falling back to `GATEWAY_SHARD_URLS`/
  `GATEWAY_URL` when no shards are registered), but only one of each is
  actually deployed right now -- the pairing exists in code, not yet in
  practice. Also, sessions are assigned a shard once at creation time and
  never move, so adding a shard only spreads out sessions created after
  that point.
- The agent (`!ag`) is tested thoroughly at the logic level (contact
  resolution, plan validation, confirmation flow) but hasn't been run
  against a live LLM end to end -- real prompt quality on real phrasing is
  the open question.
- The plugin engine's free-tier host caps memory at 512MB, which is
  genuinely tight for a service that passes real audio files through
  itself (Groq Whisper transcription, Jamendo song downloads) -- both
  paths are capped at 8MB per file, but heavy concurrent usage could still
  need a paid plan for that one service eventually.
- Song Fetcher only finds independent/Creative-Commons music (Jamendo's
  catalog) -- a request for a mainstream commercial song will come up
  empty by design, not by bug.
- Anti-Delete and Notes only capture media up to 8MB; a larger file (e.g.
  a long video) that gets deleted or reply-quoted for `!savenote` won't be
  recoverable/saveable.
- See `STATUS.md` for current deployment details and anything in progress.
