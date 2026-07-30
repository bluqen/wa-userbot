import base64
import os
from typing import List, Optional

import httpx

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

# Groq's rate limits are per-model, not account-wide -- when the primary
# model is capped (429, seen in practice hitting both Groq and Gemini at
# once during a burst of AI Write calls), a different model can still have
# headroom. Tried in order, before falling back to Gemini.
GROQ_FALLBACK_MODELS = [
    m.strip()
    for m in os.environ.get("GROQ_FALLBACK_MODELS", "llama-3.1-8b-instant").split(",")
    if m.strip()
]

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
GEMINI_URL = (
    f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
)

# Groq also serves Whisper on the same free-tier account/API key already
# used for chat above -- no separate signup or credential needed to let the
# bot understand voice notes.
GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_WHISPER_MODEL = os.environ.get("GROQ_WHISPER_MODEL", "whisper-large-v3-turbo")


def has_provider() -> bool:
    return bool(GROQ_API_KEY or GEMINI_API_KEY)


def transcribe_audio(audio_bytes: bytes, mimetype: str) -> Optional[str]:
    """Transcribes a WhatsApp voice note via Groq's Whisper endpoint.
    Returns None on any failure (no Groq key configured, quota hit,
    unreadable audio, etc.) -- callers treat that exactly like an incoming
    message with nothing usable in it, rather than erroring out.
    """
    if not GROQ_API_KEY:
        return None
    try:
        # WhatsApp voice notes are Opus-in-Ogg; a couple of other mimetypes
        # are accepted too in case a client ever sends one differently.
        # Whisper only looks at the filename's extension to sniff format,
        # not the multipart Content-Type, so this has to actually match.
        if "ogg" in mimetype:
            ext = "ogg"
        elif "mp4" in mimetype or "m4a" in mimetype:
            ext = "m4a"
        elif "wav" in mimetype:
            ext = "wav"
        else:
            ext = "ogg"

        with httpx.Client(timeout=30.0) as client:
            res = client.post(
                GROQ_TRANSCRIBE_URL,
                headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
                files={"file": (f"voice.{ext}", audio_bytes, mimetype)},
                data={"model": GROQ_WHISPER_MODEL, "response_format": "json"},
            )
            res.raise_for_status()
            data = res.json()
            return (data.get("text") or "").strip() or None
    except Exception as exc:
        print(f"[llm] Groq transcription failed: {exc}")
        return None


def generate(
    system_prompt: str,
    user_message: str,
    history: Optional[List[dict]] = None,
    max_tokens: int = 200,
    temperature: float = 0.9,
) -> Optional[str]:
    """Tries Groq first (fast, generous free tier), falls back to Gemini if
    that fails -- e.g. once Groq's daily free quota is used up -- so the two
    free tiers effectively stack instead of a caller just going quiet.

    `history` is prior turns, oldest first, as [{role, text}, ...] with
    role 'user' or 'assistant' -- included as real conversation turns, not
    just flattened into the prompt text, so the model can actually use it.
    """
    if GROQ_API_KEY:
        for model in [GROQ_MODEL, *GROQ_FALLBACK_MODELS]:
            text = _generate_groq(system_prompt, user_message, history, max_tokens, temperature, model)
            if text:
                return text

    if GEMINI_API_KEY:
        text = _generate_gemini(system_prompt, user_message, history, max_tokens, temperature)
        if text:
            return text

    return None


def _generate_groq(
    system_prompt: str,
    user_message: str,
    history: Optional[List[dict]],
    max_tokens: int,
    temperature: float,
    model: str,
) -> Optional[str]:
    try:
        messages = [{"role": "system", "content": system_prompt}]
        for turn in history or []:
            role = "assistant" if turn.get("role") == "assistant" else "user"
            messages.append({"role": role, "content": turn.get("text", "")})
        messages.append({"role": "user", "content": user_message})

        with httpx.Client(timeout=15.0) as client:
            res = client.post(
                GROQ_URL,
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": messages,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                },
            )
            res.raise_for_status()
            data = res.json()
            return data["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        print(f"[llm] Groq ({model}) request failed: {exc}")
        return None


def _generate_gemini(
    system_prompt: str,
    user_message: str,
    history: Optional[List[dict]],
    max_tokens: int,
    temperature: float,
) -> Optional[str]:
    try:
        # Gemini's chat turns use role 'user' / 'model' (not 'assistant'),
        # and the system prompt is passed separately from `contents`.
        contents = []
        for turn in history or []:
            role = "model" if turn.get("role") == "assistant" else "user"
            contents.append({"role": role, "parts": [{"text": turn.get("text", "")}]})
        contents.append({"role": "user", "parts": [{"text": user_message}]})

        with httpx.Client(timeout=15.0) as client:
            res = client.post(
                GEMINI_URL,
                params={"key": GEMINI_API_KEY},
                json={
                    "system_instruction": {"parts": [{"text": system_prompt}]},
                    "contents": contents,
                    "generationConfig": {"maxOutputTokens": max_tokens, "temperature": temperature},
                },
            )
            res.raise_for_status()
            data = res.json()
            return data["candidates"][0]["content"]["parts"][0]["text"].strip()
    except Exception as exc:
        print(f"[llm] Gemini request failed: {exc}")
        return None


def generate_vision(
    system_prompt: str,
    user_message: str,
    image_bytes: bytes,
    mimetype: str,
    history: Optional[List[dict]] = None,
    max_tokens: int = 200,
    temperature: float = 0.9,
) -> Optional[str]:
    """Like generate(), but the user turn includes an image (see ai_reply.py
    reacting to an incoming sticker). Only Gemini's API supports multimodal
    input among the providers wired up here -- Groq's chat completions are
    text-only -- so this has no Groq fallback and simply returns None if
    Gemini isn't configured, letting the caller fall back to a text-only
    reply instead of going quiet.
    """
    if not GEMINI_API_KEY:
        return None
    try:
        contents = []
        for turn in history or []:
            role = "model" if turn.get("role") == "assistant" else "user"
            contents.append({"role": role, "parts": [{"text": turn.get("text", "")}]})

        parts = []
        if user_message:
            parts.append({"text": user_message})
        parts.append({"inline_data": {"mime_type": mimetype, "data": base64.b64encode(image_bytes).decode()}})
        contents.append({"role": "user", "parts": parts})

        with httpx.Client(timeout=20.0) as client:
            res = client.post(
                GEMINI_URL,
                params={"key": GEMINI_API_KEY},
                json={
                    "system_instruction": {"parts": [{"text": system_prompt}]},
                    "contents": contents,
                    "generationConfig": {"maxOutputTokens": max_tokens, "temperature": temperature},
                },
            )
            res.raise_for_status()
            data = res.json()
            return data["candidates"][0]["content"]["parts"][0]["text"].strip()
    except Exception as exc:
        print(f"[llm] Gemini vision request failed: {exc}")
        return None
