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
                        HTTP /message, /rewrite
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

## The three plugins

All configured per WhatsApp session from the dashboard's Plugins page
(`/dashboard/sessions/[id]/plugins`). Each is a card: toggle to
enable/disable, expand to edit settings.

- **Auto Reply** -- fixed message, optional group-chat replies, typing
  simulation, per-contact cooldown, per-contact exceptions.
- **AI Reply** -- LLM-generated replies. Pick from 100 personalities (see
  `personalities.json` at the repo root, shared between the website's
  dropdown and the Python plugin) or write a custom one. Remembers the
  last N messages per contact for multi-turn context. Per-contact
  exceptions can give a specific number its own personality or exclude it
  entirely.
- **AI Write** -- instantly edits the *owner's own* outgoing messages
  (typo/grammar fixes by default, or a chosen tone/translation/custom
  style) via WhatsApp's native message-edit feature.

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

## Known limitations

- No rate limiting/abuse protection on outgoing replies yet -- bulk
  messaging risk with an unofficial WhatsApp client (Baileys). Keep volume
  reasonable.
- Shard routing (`GATEWAY_SHARD_URLS`) supports multiple gateway instances
  but only one is actually running right now.
- Not yet deployed anywhere -- still running locally. See `STATUS.md` for
  the hosting plan (Render free tier + UptimeRobot).
- See `STATUS.md` for the current in-progress work and open questions.
