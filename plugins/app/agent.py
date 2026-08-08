"""Turns a plain-language instruction ("tell mum and dad I won't be home
soon") into a small, strictly-shaped plan of WhatsApp actions.

Two deliberate boundaries, both about safety rather than tidiness:

1. This module never sees the owner's contact list, and never produces a
   phone number or JID. It only ever echoes back the *names the user
   themselves wrote*. Resolving a name to a real person is done by the
   gateway against the actual contact book (see resolveAgentContact in
   whatsappManager.js). So a hallucinated contact can't become a real
   recipient -- the worst an invented name can do is fail to resolve --
   and the owner's address book never leaves their own gateway.

2. Nothing here sends anything. The plan is data; the gateway shows it to
   the owner and only acts after they confirm. Every limit below is
   enforced again on that side, since LLM output is untrusted input.
"""

import json
import re
from typing import Optional

from . import llm

MAX_STEPS = 8
MAX_VALUE_LENGTH = 2000
MAX_LIST_ITEMS = 12
MAX_FIELDS_PER_STEP = 12
MAX_NOTE_LENGTH = 300
MAX_INSTRUCTION_LENGTH = 1000

PROMPT_HEADER = """You turn a WhatsApp user's instruction into a plan of actions to carry out for them.

Reply with ONLY a JSON object. No markdown fences, no commentary before or after:
{"steps": [ ... ], "note": "<one short line for the user, or why you couldn't build a plan>"}

These are the ONLY actions available. Each step must match one of these shapes exactly:"""

PROMPT_RULES = """Rules:
- Use only the actions listed above. If the instruction needs something not on that list, return {"steps": [], "note": "<short reason>"}.
- Any "contact" is the person's name EXACTLY as the user referred to them ("mum", "roger"). Never invent a phone number. Never add a recipient the user did not mention.
- One step per recipient: "tell mum and dad I'm late" is two separate message steps.
- Write any message text in the user's own voice: first person, casual, as if they typed it themselves. Do not add greetings, sign-offs, emoji, or detail they didn't ask for. Keep it short.
- Durations are written like "30m", "2h", "1h30m".
- Prefer the simplest plan that does what was asked. Don't invent extra steps.

Example. Instruction: tell mum, dad and roger i wont be home soon
{"steps": [{"action": "message", "contact": "mum", "text": "I won't be home soon"}, {"action": "message", "contact": "dad", "text": "I won't be home soon"}, {"action": "message", "contact": "roger", "text": "I won't be home soon"}], "note": "Letting 3 people know you'll be late."}"""


def build_prompt(actions: list) -> str:
    """The action menu is supplied by the gateway (see buildAgentCatalog in
    agentActions.js) rather than hardcoded here, so the planner's idea of
    what it can do is always exactly what the gateway can actually execute.
    """
    lines = [PROMPT_HEADER, ""]
    for action in actions:
        lines.append(f"- {action.get('name')}: {action.get('summary')}")
        lines.append(f"  {action.get('params')}")
    lines.append("")
    lines.append(PROMPT_RULES)
    return "\n".join(lines)


def _extract_json(raw: str) -> Optional[dict]:
    """LLMs wrap JSON in prose or markdown fences often enough that going
    straight to json.loads throws away otherwise-valid plans. Strip fences,
    then fall back to the outermost {...} span.
    """
    text = (raw or "").strip()
    if not text:
        return None

    fenced = re.match(r"^```(?:json)?\s*([\s\S]+?)\s*```$", text)
    if fenced:
        text = fenced.group(1).strip()

    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except (ValueError, TypeError):
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        parsed = json.loads(text[start : end + 1])
        return parsed if isinstance(parsed, dict) else None
    except (ValueError, TypeError):
        return None


def _clean_step(raw, allowed_actions: set) -> Optional[dict]:
    """Sanitizes one step into plain, size-bounded JSON values, or returns
    None if it's malformed. Deliberately drops anything questionable
    rather than trying to repair it -- a half-understood step is a message
    sent to the wrong person.

    Only generic shape is enforced here (known action name, scalar types,
    length caps). Whether a step actually has the fields its action needs
    is decided by the gateway's own registry, which is the authority on
    what each action requires -- see AGENT_ACTIONS in agentActions.js.
    """
    if not isinstance(raw, dict):
        return None

    action = raw.get("action")
    if not isinstance(action, str) or action.strip().lower() not in allowed_actions:
        return None

    step = {"action": action.strip().lower()}
    for key, value in list(raw.items())[:MAX_FIELDS_PER_STEP]:
        if key == "action" or not isinstance(key, str):
            continue
        if isinstance(value, str):
            cleaned = value.strip()[:MAX_VALUE_LENGTH]
            if cleaned:
                step[key] = cleaned
        elif isinstance(value, list):
            items = [
                item.strip()[:MAX_VALUE_LENGTH]
                for item in value[:MAX_LIST_ITEMS]
                if isinstance(item, str) and item.strip()
            ]
            if items:
                step[key] = items
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            step[key] = str(value)
        # anything else (nested objects, booleans, null) is dropped

    return step


def plan(instruction: str, actions: Optional[list] = None) -> dict:
    """Returns {"steps": [...], "note": str}. An empty steps list means
    nothing actionable was produced -- `note` says why, and the gateway
    shows it to the owner instead of a plan.
    """
    catalog = actions or []
    allowed = {
        a.get("name", "").strip().lower()
        for a in catalog
        if isinstance(a, dict) and isinstance(a.get("name"), str)
    }
    if not allowed:
        return {"steps": [], "note": "No actions are available right now."}

    cleaned = (instruction or "").strip()[:MAX_INSTRUCTION_LENGTH]
    if not cleaned:
        return {"steps": [], "note": "Tell me what you'd like me to do."}

    raw = llm.generate(
        build_prompt(catalog),
        cleaned,
        max_tokens=700,
        # Low but not zero: this is a structured extraction task, where
        # creativity is the enemy -- the same instruction should produce
        # the same plan.
        temperature=0.2,
    )
    if not raw:
        return {"steps": [], "note": "Couldn't work that out right now -- try again?"}

    parsed = _extract_json(raw)
    if parsed is None:
        return {"steps": [], "note": "Couldn't work that out -- try rephrasing?"}

    steps = []
    for raw_step in parsed.get("steps") or []:
        step = _clean_step(raw_step, allowed)
        if step is not None:
            steps.append(step)
        if len(steps) >= MAX_STEPS:
            break

    note = parsed.get("note")
    note = note.strip()[:MAX_NOTE_LENGTH] if isinstance(note, str) else ""
    if not steps and not note:
        note = "Couldn't turn that into anything I can do."

    return {"steps": steps, "note": note}
