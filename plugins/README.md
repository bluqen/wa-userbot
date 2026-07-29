# plugins/

Python + FastAPI. Decides how to respond to incoming WhatsApp messages
(`/message`), and whether/how to edit the userbot owner's own outgoing
messages (`/rewrite`). Stateless between requests except for small
in-memory caches (cooldowns) -- all real config and history live in the
web app's Postgres database, fetched per request.

## Files

- `app/main.py` -- the FastAPI routes. `/message` fetches this session's
  plugin configs + recent chat history in one call, saves the incoming
  message to history (fire-and-forget -- see "Latency" below), runs a
  global reply-rate check, then runs plugins in priority order until one
  replies, saving the reply to history too (also fire-and-forget).
  `/rewrite` runs the AI Write plugin directly (it isn't part of the
  auto-discovered reply-plugin set -- see below). `GET
  /session/{id}/exception-numbers` returns every phone number this
  session has a per-contact exception configured for, across all plugins
  -- called by the gateway to resolve LID-addressed contacts back to a
  phone number (see `gateway/README.md`'s "LID resolution").
- `app/plugin_base.py` -- `MessageContext` (includes `history`), `Reply`,
  the `Plugin` ABC, and `resolve_settings()` (the per-contact exceptions
  merge logic, shared by autoreply and ai_reply).
- `app/plugin_loader.py` -- auto-discovers any `Plugin` subclass under
  `app/plugins/` and instantiates the enabled ones for a given session,
  sorted by priority.
- `app/session_config.py` -- talks to the web app's internal API
  (`fetch_session_plugins`, `fetch_session_context`, `save_message`),
  authenticated via a shared secret header (`INTERNAL_API_SECRET`). Each
  call has a 5-second timeout -- if the web app is cold-starting (e.g. on
  Render free tier after inactivity spin-down), calls here fail and
  `/message` returns no reply rather than waiting it out.
- `app/rate_limiter.py` -- a global circuit breaker independent of any
  plugin's own cooldown setting: caps a single contact to 6 auto-replies
  per 60 seconds, then pauses replies to that contact for 5 minutes. Exists
  specifically to stop the case where the other side is *also* an
  automated bot and the two reply to each other back-to-back at machine
  speed -- a real human conversation never gets remotely close to the
  threshold. Its per-contact tracking dict is periodically swept (see
  "Memory" below) rather than growing forever.
- `app/stale_cache.py` -- shared cleanup helper (`maybe_sweep`) for the
  handful of per-`(session_id, contact_jid)` dicts across this codebase
  that would otherwise grow by one entry for every distinct contact ever
  seen, for the process's entire lifetime -- a real memory leak on a
  memory-constrained host. See "Memory" below.
- `app/llm.py` -- shared LLM client, used by `ai_reply`, `ai_write`, and
  voice-note transcription. Tries `GROQ_MODEL`, then each of
  `GROQ_FALLBACK_MODELS` (env var, comma-separated, defaults to
  `llama-3.1-8b-instant`) before falling back to Gemini -- Groq's rate
  limits are per-model, not account-wide, so a different model can still
  have headroom when the primary one is capped. Supports multi-turn
  history (Groq: OpenAI-style `messages` array; Gemini: `contents` with
  role `model` instead of `assistant`). Also has `transcribe_audio()` --
  Groq also serves Whisper on the same free-tier account/API key already
  used for chat, no separate signup needed.
- `app/personalities.py` -- loads `../personalities.json` (repo root, 100
  entries, shared with the web dashboard's dropdown).
- `app/plugins/autoreply.py`, `ai_reply.py` -- real `Plugin` subclasses,
  auto-discovered. `ai_reply.py` also supports opt-in blocking (see
  "Blocking abusive contacts" below), sticker sending, and voice-note
  awareness (see "Humanlikeness" and "Stickers" below).
- `app/plugins/ai_write.py` -- **not** a `Plugin` subclass (different
  shape: `should_process(session_id, chat_jid, text)` /
  `rewrite(session_id, chat_jid, text)`, since it acts on the owner's own
  messages, not incoming ones). Instantiated directly in `main.py`'s
  `/rewrite` handler. Has its own opt-in `cooldownMinutes` (per
  session+chat, default 0/off) to throttle LLM call volume if a burst of
  the owner's own messages is causing rate-limit errors -- separate from
  `rate_limiter.py`'s circuit breaker, which is about auto-reply loops,
  not the owner's own outgoing messages.
- `app/plugins/song.py` -- `SongPlugin`, triggered by
  `/song <genre, mood, or artist>` from anyone chatting with the bot.
  Searches Jamendo's Creative-Commons/independent-music catalog (built for
  exactly this kind of third-party redistribution, unlike ripping
  YouTube/Spotify) and sends back a track with artist/license attribution.
  Requires `JAMENDO_CLIENT_ID` (see "Env vars" below); silently doesn't
  match if unset. The download is streamed with an 8MB cap (see "Memory"
  below) rather than fully buffered before checking its size.

Anti-Delete and Notes are **not** here -- they're implemented entirely in
the gateway (`gateway/src/whatsappManager.js`) since they need direct
Baileys access (detecting a delete-for-everyone protocol message, reading
message content before it's revoked) that this service has no reason to
see. See `gateway/README.md`.

## Blocking abusive contacts

`Reply` (`plugin_base.py`) carries `block: bool` and
`block_duration_hours: int`, threaded through `ReplyResponse` to the
gateway, which actually calls Baileys' `updateBlockStatus`. Off by default
per session (`allowBlocking` setting) -- an LLM autonomously blocking a
real contact with no human in the loop is a real enough risk that it
shouldn't be default-on. When on, `ai_reply.py` appends instructions to
the system prompt telling the model it may include a literal `[[BLOCK]]`
marker in its reply if the contact is genuinely abusive/harassing; the
marker is always stripped from the outgoing text regardless (never leaks
to a real message), but only actually triggers a block when
`allowBlocking` is on and the contact isn't a group chat (checked again
here, not just at prompt-injection time, as defense in depth against a
hallucinated/copied marker). `blockDurationHours` (0 = permanent) rides
along on the same response -- see `gateway/README.md`'s "Scheduled tasks"
for how a temporary block automatically un-blocks later.

## Humanlikeness (`ai_reply.py`)

A 0-100 per-session setting, surfaced on the dashboard as named
checkpoints (Off/Subtle/Natural/Expressive/Maximum at 0/25/50/75/100) --
the underlying value is still a plain number, the UI just snaps the
slider to those five points. At `0`, behavior is unchanged from before
this existed: the configured `typingDurationMs` is used exactly, and
every reply is a single plain message. Above `0`:

- **Start delay** (`_compute_start_delay_ms`) -- a random pause *before
  reacting at all*, independent of whether a typing indicator is even
  shown. Without this, a reply with `showTyping` off still fired the
  instant a message arrived regardless of humanlikeness.
- **Randomized typing delay** (`_compute_delay_ms`) -- widens the range
  randomly sampled around a base value; higher values mean more variance,
  the way a real person's response time swings far more than any fixed
  number would. The base itself now scales with the reply's actual length
  (`_estimate_typing_ms`, ~40ms/char) rather than being one fixed number
  regardless of message length -- `typingDurationMs` (the dashboard
  setting) acts as a floor, not the only input.
- **Style roll** (`_pick_style`) -- each reply independently rolls
  `plain`/`quote`/`split`, weighted by humanlikeness (max ~35% quote,
  ~40% split at 100), **decided before generation**, not inferred
  afterward from whatever text came back. `quote` replies to the specific
  incoming message (WhatsApp's swipe-reply) instead of sending a new one.
  `split` asks the model directly to write two short parts separated by a
  `[[SPLIT]]` marker (same sentinel-marker pattern as `[[BLOCK]]`/
  `[[STICKER:tag]]` below) -- deciding this *before* the LLM call, rather
  than checking after the fact whether the generated text happened to
  have 2+ sentences, was a real fix: once brevity prompting (below) was
  added, a good short reply is often exactly one sentence, so the
  after-the-fact check almost never found anything to split.
- **Reply-length cap** -- at humanlikeness >= 50, the prompt directly asks
  for a short, casual reply and the LLM call gets a smaller `max_tokens`
  budget (`_max_reply_tokens`); a character-count truncation
  (`_max_reply_chars`/`_truncate_naturally`, cutting at a sentence or word
  boundary, never mid-word) backstops both for whenever they weren't
  enough on their own. A normal full-length LLM response is itself a tell
  at higher humanlikeness -- real texting is rarely a whole paragraph.
- **Stray-marker cleanup** (`_STRAY_MARKER_RE`) -- the model occasionally
  hallucinates a bracket-wrapped word that isn't one of the three real
  markers (seen in practice: `[[beautiful]]`), most likely confusing
  itself over the several `[[...]]` conventions in its own prompt. Left
  alone, that leaks into the visible message *and* gets saved to that
  contact's chat history, where the model then imitates its own past habit
  on the next turn -- self-reinforcing for that one conversation. Stripped
  unconditionally, alongside the three real markers, before the reply is
  ever returned.

The actual sending (multi-part timing, the `quoted` option) happens in
`gateway/src/whatsappManager.js` -- this plugin only decides the strategy
and hands back `Reply.quote`/`Reply.parts`.

## Stickers (`ai_reply.py`)

Opt-in per session (`useSticker`, default on but inert until stickers
exist; `stickerChance` slider, default 0). When a sticker tag is offered
this turn (a random roll against `stickerChance`, only when
`ctx.sticker_tags` is non-empty), the system prompt tells the model it may
include `[[STICKER:tag]]` (one of the exact tags listed) anywhere in its
reply. Same "strip regardless, act only if actually offered and valid"
shape as `[[BLOCK]]`: the marker is always stripped, but `Reply.sticker_tag`
is only set if a sticker was actually offered this turn *and* the model's
tag matches one it was actually given (defense against both leakage and a
hallucinated/copied tag). See `gateway/README.md`'s "Sticker capture and
sending" for how a sticker actually gets taught (`/savesticker`) and sent.

## Voice notes

A voice note arrives with no text at all (`IncomingMessage.audio`, a
base64 payload) -- `main.py`'s `/message` handler transcribes it via
`llm.transcribe_audio()` (Groq Whisper) and treats the result exactly like
typed text from then on, so every plugin (keyword Auto Reply, AI Reply,
chat history) just works without any awareness that voice was involved.
Only bothers if at least one plugin is actually enabled for the session --
transcription is a real API call, not worth making otherwise.
`MessageContext.is_voice` lets AI Reply add a light system-prompt nudge
("this was transcribed, don't overreact to a mis-heard word") without
changing anything else about how it replies.

## Memory

Three per-`(session_id, contact_jid)` dicts (`rate_limiter.py`'s
`_reply_timestamps`, `ai_reply.py`'s `_last_replied`, `ai_write.py`'s
`_last_rewritten`) used to never remove an entry once created -- every
distinct contact who ever messaged any session left a permanent entry for
the process's entire lifetime, eventually exhausting a memory-constrained
host's RAM. `rate_limiter.py`'s is the fastest-growing since it runs on
*every* incoming message, and now also deletes a contact's entry outright
once their timestamps age out (previously left an empty list sitting
there forever). All three additionally get a periodic probabilistic sweep
(`app/stale_cache.py`'s `maybe_sweep`) that catches a contact who messages
once and then never returns, which trim-on-access alone can't. Add any
future per-contact tracking dict through `maybe_sweep` from the start
rather than bolting cleanup on later.

Also worth knowing: `song.py`'s Jamendo download is capped at 8MB and
streamed (aborts mid-download rather than fully buffering an oversized
file first) -- match this pattern for any future feature that downloads a
file into memory.

## Latency

Both `save_message()` calls in `/message` are scheduled with
`asyncio.create_task(...)` rather than `await`ed -- neither reply
generation nor delivery depends on the history write completing, so
there's no reason to block on a round trip through web's internal API to
Postgres for it. `save_message()` already catches and logs its own
errors, so a failed save behaves the same as before (silently logged),
just no longer serialized in front of the reply.

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

This matches on phone number extracted from the JID. WhatsApp sometimes
addresses a contact by an opaque "LID" (e.g. `17206192644250@lid`) instead
of their real number in `remoteJid` -- confirmed this really happens in
practice (not just a hypothetical), and fixed on the gateway side: the
gateway resolves LID-addressed messages back to the real phone-number JID
before they ever reach `/message`, so `from_jid` here is always a phone
number by the time exceptions matching runs. See `gateway/README.md`'s
"LID resolution" section for how. The `GET
/session/{id}/exception-numbers` route above exists specifically to
support that resolution (the gateway calls it to know which phone numbers
are even worth resolving a LID for).

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
- `GROQ_FALLBACK_MODELS` -- comma-separated, tried in order if `GROQ_MODEL`
  is rate-limited before falling back to Gemini. Defaults to
  `llama-3.1-8b-instant`.
- `GEMINI_API_KEY`, `GEMINI_MODEL` -- already configured, used as fallback.
- `GROQ_WHISPER_MODEL` -- optional, defaults to `whisper-large-v3-turbo`.
  Used for voice-note transcription (same `GROQ_API_KEY`, no separate
  signup).
- `JAMENDO_CLIENT_ID` -- optional, powers the Song Fetcher plugin. Free
  signup at [developer.jamendo.com](https://developer.jamendo.com); the
  plugin silently does nothing if this is unset.

**Import-order gotcha**: `main.py` calls `load_dotenv()` as the very first
thing, before any local imports -- `plugin_loader.py`'s auto-discovery
imports every plugin module at import time, and plugins read API keys from
`os.environ` at *their own* module-import time. If `.env` isn't loaded
before that happens, those reads silently bake in empty strings. Don't
reorder the top of `main.py`.

**Health check gotcha**: `GET /health` is declared with
`@app.api_route("/health", methods=["GET", "HEAD"])`, not a plain
`@app.get(...)`. FastAPI doesn't auto-accept `HEAD` on a GET-only route
(unlike Express and Next.js, which do) -- UptimeRobot's default monitor
method is `HEAD`, and without this it 405s, which UptimeRobot reports as
the service being down even though it's actually fine.
