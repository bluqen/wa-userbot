import os
from typing import List, Optional

import httpx

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
GEMINI_URL = (
    f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
)


def has_provider() -> bool:
    return bool(GROQ_API_KEY or GEMINI_API_KEY)


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
        text = _generate_groq(system_prompt, user_message, history, max_tokens, temperature)
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
                    "model": GROQ_MODEL,
                    "messages": messages,
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                },
            )
            res.raise_for_status()
            data = res.json()
            return data["choices"][0]["message"]["content"].strip()
    except Exception as exc:
        print(f"[llm] Groq request failed, will try Gemini if configured: {exc}")
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
