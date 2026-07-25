import json
from pathlib import Path
from typing import Optional

_PERSONALITIES_PATH = Path(__file__).resolve().parent.parent.parent / "personalities.json"

with open(_PERSONALITIES_PATH, "r", encoding="utf-8") as f:
    _DATA = json.load(f)

_BY_ID = {p["id"]: p for p in _DATA["personalities"]}


def get_personality_prompt(personality_id: Optional[str]) -> Optional[str]:
    entry = _BY_ID.get(personality_id or "")
    return entry["prompt"] if entry else None
