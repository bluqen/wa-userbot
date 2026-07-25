# plugins/

Python + FastAPI. Decides how to respond to incoming WhatsApp messages
(`/message`), and whether/how to edit the userbot owner's own outgoing
messages (`/rewrite`). Stateless between requests except for small
in-memory caches (cooldowns) -- all real config and history live in the
web app's Postgres database, fetched per request.

## Files

- `app/main.py` -- the two FastAPI routes. `/message` fetches this
  session's plugin configs + recent chat history in one call, saves the
  incoming message to history, runs plugins in priority order until one
  replies, saves the reply to history too. `/rewrite` runs the AI Write
  plugin directly (it isn't part of the auto-discovered reply-plugin set --
  see below).
- `app/plugin_base.py` -- `MessageContext` (includes `history`), `Reply`,
  the `Plugin` ABC, and `resolve_settings()` (the per-contact exceptions
  merge logic, shared by autoreply and ai_reply).
- `app/plugin_loader.py` -- auto-discovers any `Plugin` subclass under
  `app/plugins/` and instantiates the enabled ones for a given session,
  sorted by priority.
- `app/session_config.py` -- talks to the web app's internal API
  (`fetch_session_plugins`, `fetch_session_context`, `save_message`),
  authenticated via a shared secret header (`INTERNAL_API_SECRET`).
- `app/llm.py` -- shared Groq-then-Gemini-fallback LLM client, used by both
  `ai_reply` and `ai_write`. Supports multi-turn history (Groq: OpenAI-style
  `messages` array; Gemini: `contents` with role `model` instead of
  `assistant`).
- `app/personalities.py` -- loads `../personalities.json` (repo root, 100
  entries, shared with the web dashboard's dropdown).
- `app/plugins/autoreply.py`, `ai_reply.py` -- real `Plugin` subclasses,
  auto-discovered.
- `app/plugins/ai_write.py` -- **not** a `Plugin` subclass (different
  shape: `should_process()` / `rewrite()`, since it acts on the owner's own
  messages, not incoming ones). Instantiated directly in `main.py`'s
  `/rewrite` handler.

## The `Plugin` interface (reply plugins)

```python
from typing import Optional
from ..plugin_base import MessageContext, Plugin, Reply, resolve_settings

class MyPlugin(Plugin):
    name = "my_plugin"     # unique key; the web dashboard references this
    priority = 75            # lower runs first; first match wins

    def match(self, ctx: MessageContext) -> bool:
        config = resolve_settings(self.config, ctx.from_jid)  # apply per-contact exceptions
        if config.get("enabled") is False:  # contact is excluded
            return False
        return "ping" in ctx.text.lower()

    def handle(self, ctx: MessageContext) -> Optional[Reply]:
        return Reply(text="pong", show_typing=True, typing_delay_ms=1500)
```

Drop the file in `app/plugins/`, it's auto-discovered -- no registration
needed. To actually show up as a card on the dashboard, add it to
`web/lib/plugins.ts` too (key, display name, description, default
settings) and build a settings component if it needs configuration.

`self.config` is whatever JSON was saved for this plugin+session via the
dashboard. Call `resolve_settings(self.config, ctx.from_jid)` at the top of
`match()`/`handle()` if the plugin should support per-contact exceptions
(see "Per-contact exceptions" below) -- both existing reply plugins do
this.

## Per-contact exceptions

Any reply plugin's settings can include an `exceptions` array:

```json
{
  "message": "default message",
  "exceptions": [
    { "phoneNumber": "15551234567", "overrides": { "message": "special message for this contact" } },
    { "phoneNumber": "15559876543", "overrides": { "enabled": false } }
  ]
}
```

`resolve_settings()` matches `phoneNumber` (digits only) against the
digits in `ctx.from_jid`, and shallow-merges `overrides` onto the base
config if found. `overrides.enabled: false` is the convention for
"exclude this contact entirely."

**Known open issue**: this matches on phone number extracted from the
JID. WhatsApp sometimes addresses a contact by an opaque "LID" (e.g.
`17206192644250@lid`) instead of their real number in `remoteJid` -- if
that happens, phone-number matching won't find the exception. Not yet
confirmed how often this actually occurs in practice; see `STATUS.md`.
There's a debug line already in `main.py`'s `/message` handler
(`print(f"[debug] incoming message from_jid=...")`) to inspect real
traffic if this needs investigating further.

## Chat history

`main.py` saves every user message and every bot reply to the web app's
`ChatMessage` table (via `save_message`), and fetches up to 50 recent
messages per (session, contact) alongside plugin config in the same
request (`fetch_session_context`). `ai_reply.py` slices that down to its
own `historyLength` setting (default 10) before building the LLM prompt.
Retention (50 per contact) is enforced server-side on the web app, not
here.

## Env vars (`.env`)

- `WEB_APP_URL` -- base URL of the web app's internal API.
- `INTERNAL_API_SECRET` -- shared secret, must match `web/.env`'s value.
- `GROQ_API_KEY`, `GROQ_MODEL` -- already configured.
- `GEMINI_API_KEY`, `GEMINI_MODEL` -- already configured, used as fallback.

**Import-order gotcha**: `main.py` calls `load_dotenv()` as the very first
thing, before any local imports -- `plugin_loader.py`'s auto-discovery
imports every plugin module at import time, and plugins read API keys from
`os.environ` at *their own* module-import time. If `.env` isn't loaded
before that happens, those reads silently bake in empty strings. Don't
reorder the top of `main.py`.
