import random
import re
import time
from typing import Optional

from ..plugin_base import MessageContext, Plugin, Reply, resolve_settings
from ..stale_cache import maybe_sweep

EIGHT_BALL_COMMAND = re.compile(r"^/8ball(?:\s+.+)?$", re.IGNORECASE)
RPS_COMMAND = re.compile(r"^/rps\s+(rock|paper|scissors)$", re.IGNORECASE)
TRIVIA_COMMAND = re.compile(r"^/trivia$", re.IGNORECASE)
TRIVIA_ANSWER_COMMAND = re.compile(r"^/trivia\s+answer\s+([a-dA-D])$", re.IGNORECASE)

EIGHT_BALL_ANSWERS = [
    "It is certain.", "Without a doubt.", "Yes, definitely.", "You may rely on it.",
    "As I see it, yes.", "Most likely.", "Outlook good.", "Signs point to yes.",
    "Reply hazy, try again.", "Ask again later.", "Better not tell you now.",
    "Cannot predict now.", "Concentrate and ask again.", "Don't count on it.",
    "My reply is no.", "My sources say no.", "Outlook not so good.", "Very doubtful.",
]

RPS_BEATS = {"rock": "scissors", "paper": "rock", "scissors": "paper"}

TRIVIA_QUESTIONS = [
    {
        "question": "What is the largest planet in our solar system?",
        "options": ["Earth", "Jupiter", "Saturn", "Mars"],
        "correct": "B",
    },
    {
        "question": "How many continents are there on Earth?",
        "options": ["5", "6", "7", "8"],
        "correct": "C",
    },
    {
        "question": "What is the chemical symbol for gold?",
        "options": ["Go", "Gd", "Au", "Ag"],
        "correct": "C",
    },
    {
        "question": "Which country invented pizza?",
        "options": ["France", "Italy", "Greece", "Spain"],
        "correct": "B",
    },
    {
        "question": "What is the smallest prime number?",
        "options": ["0", "1", "2", "3"],
        "correct": "C",
    },
    {
        "question": "How many strings does a standard guitar have?",
        "options": ["4", "5", "6", "7"],
        "correct": "C",
    },
    {
        "question": "What is the tallest mountain in the world?",
        "options": ["K2", "Everest", "Kilimanjaro", "Denali"],
        "correct": "B",
    },
]

# (session_id, chat_jid) -> pending trivia question. Periodically swept
# (see stale_cache.py) so an abandoned question -- nobody ever answers --
# doesn't sit here forever; a real answer or a fresh /trivia both replace
# it anyway.
_pending_trivia: dict = {}
_PENDING_TRIVIA_STALE_AFTER_SECONDS = 30 * 60


class GamesPlugin(Plugin):
    """A handful of lightweight games/fun commands -- 8-ball, rock-paper-
    scissors, and trivia -- for anyone chatting with the bot. No LLM
    involved; these are simple, deterministic commands, matching the
    "games & fun" command set nearly every popular WhatsApp userbot ships.
    """

    name = "games"
    priority = 46

    def match(self, ctx: MessageContext) -> bool:
        config = resolve_settings(self.config, ctx.from_jid)
        if config.get("enabled") is False:
            return False

        is_group = ctx.from_jid.endswith("@g.us")
        if is_group and not config.get("replyInGroups", False):
            return False

        text = ctx.text.strip()
        if EIGHT_BALL_COMMAND.match(text) or RPS_COMMAND.match(text) or TRIVIA_COMMAND.match(text):
            return True
        if TRIVIA_ANSWER_COMMAND.match(text):
            return True
        return False

    def handle(self, ctx: MessageContext) -> Optional[Reply]:
        text = ctx.text.strip()
        key = (ctx.user_id, ctx.from_jid)

        if EIGHT_BALL_COMMAND.match(text):
            return Reply(text=f"\U0001F3B1 {random.choice(EIGHT_BALL_ANSWERS)}")

        rps_match = RPS_COMMAND.match(text)
        if rps_match:
            user_choice = rps_match.group(1).lower()
            bot_choice = random.choice(list(RPS_BEATS.keys()))
            if bot_choice == user_choice:
                result = "It's a tie!"
            elif RPS_BEATS[bot_choice] == user_choice:
                result = "I win!"
            else:
                result = "You win!"
            return Reply(text=f"You: {user_choice} | Me: {bot_choice}\n{result}")

        if TRIVIA_COMMAND.match(text):
            question = random.choice(TRIVIA_QUESTIONS)
            _pending_trivia[key] = {
                "correct": question["correct"],
                "asked_at": time.time(),
            }
            maybe_sweep(
                _pending_trivia,
                lambda v: time.time() - v["asked_at"] > _PENDING_TRIVIA_STALE_AFTER_SECONDS,
            )
            options_text = "\n".join(
                f"{chr(65 + i)}. {opt}" for i, opt in enumerate(question["options"])
            )
            return Reply(
                text=(
                    f"\U0001F3AE Trivia!\n{question['question']}\n\n{options_text}\n\n"
                    'Reply with "/trivia answer <letter>"'
                )
            )

        answer_match = TRIVIA_ANSWER_COMMAND.match(text)
        if answer_match:
            pending = _pending_trivia.get(key)
            if not pending:
                return Reply(text='No trivia question is pending -- start one with "/trivia"')
            del _pending_trivia[key]
            guess = answer_match.group(1).upper()
            if guess == pending["correct"]:
                return Reply(text="✅ Correct!")
            return Reply(text=f"❌ Not quite -- the answer was {pending['correct']}.")

        return None
