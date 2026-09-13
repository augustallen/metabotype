"""Emit JSON parity fixtures from the Python implementation for the web port's tests.

Usage: python3 cli/tools/gen_fixtures.py test/fixtures
"""
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from metabotype.content import Content  # noqa: E402
from metabotype.learning import LearningState, review_after, update  # noqa: E402
from metabotype.typing import TypingState  # noqa: E402
from metabotype.ui.charts import compact_series  # noqa: E402

TARGETS = [
    "ab c", "Hi. Bye.", "Hi.  Bye? Yes!", "alpha beta gamma.", "one two three.",
    "A cell is busy. Sugars flow. Done.",
]


def typing_cases(rng, count):
    content = Content()
    passages = [p["text"] for p in content.passages.values()]
    cases = []
    for n in range(count):
        target = rng.choice(TARGETS + passages[:3]) if n % 4 else rng.choice(passages)
        now = [0.0]
        state = TypingState(target, lambda: now[0])
        steps = []
        seed_keys = list(target)
        while not state.complete and len(steps) < 400:
            roll = rng.random()
            if roll < 0.62:
                cursor = state.sentence()[1] + len(state.buffer)
                key = target[cursor] if cursor < len(target) else " "
            elif roll < 0.74:
                key = rng.choice("abcxyz .,")
            elif roll < 0.86:
                key = "BACKSPACE"
            elif roll < 0.9:
                key = "WORD_BACKSPACE"
            elif roll < 0.93:
                key = "PAUSE"
            elif roll < 0.96:
                key = "RESUME"
            elif roll < 0.98:
                key = "TICK"
            else:
                key = "ENTER"
            if key == "PAUSE":
                state.pause()
            elif key == "RESUME":
                state.resume()
            elif key == "TICK":
                now[0] += rng.choice([0.05, 0.5, 2.0])
            else:
                state.feed(key)
                now[0] += rng.choice([0.05, 0.1, 0.2])
            m = state.metrics()
            steps.append([
                key, now[0], state.buffer, state.position, state.sentence_index, int(state.pending_period),
                m["attempted_count"], m["first_correct"], m["incorrect_attempts"], m["correct_attempts"],
                m["backspaces"], m["word_deletions"], m["deleted_characters"], m["period_shortcuts"],
            ])
        state.resume()
        cases.append({"target": target, "steps": steps, "final": state.metrics(), "complete": state.complete})
    return cases


def learning_cases(rng, count):
    cases = []
    for _ in range(count):
        state = LearningState(rng.randint(1, 4))
        start = state.level
        steps = []
        for i in range(rng.randint(1, 12)):
            qid = str(rng.randint(0, 6))
            level = state.level if rng.random() < 0.85 else rng.randint(1, 4)
            outcome = rng.choice(["correct", "correct", "wrong", "skipped"])
            eligible = rng.random() < 0.9
            state, reason = update(state, qid, level, outcome, eligible)
            steps.append({"question": qid, "level": level, "outcome": outcome, "eligible": eligible,
                          "state": {"level": state.level, "window": state.window, "wrong_streak": state.wrong_streak},
                          "reason": reason})
        cases.append({"start": start, "steps": steps})
    reviews = []
    for _ in range(count):
        previous = None if rng.random() < 0.2 else {"stage": rng.randint(0, 3), "due": rng.randint(0, 900000)}
        outcome = rng.choice(["correct", "wrong", "skipped"])
        now = rng.randint(0, 900000)
        can_clear = rng.random() < 0.8
        result = review_after(previous, outcome, now, can_clear)
        reviews.append({"previous": previous, "outcome": outcome, "now": now, "can_clear": can_clear,
                        "result": list(result) if result else None})
    return {"updates": cases, "reviews": reviews}


def chart_cases(rng, count):
    cases = []
    for _ in range(count):
        length = rng.randint(1, 120)
        values = [None if rng.random() < 0.5 else rng.randint(0, 90) for _ in range(length)]
        columns = rng.randint(1, 60)
        step = rng.random() < 0.3
        cases.append({"values": values, "columns": columns, "step": step, "result": compact_series(values, columns, step)})
    return cases


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "test/fixtures")
    out.mkdir(parents=True, exist_ok=True)
    rng = random.Random(20260912)
    (out / "typing.json").write_text(json.dumps(typing_cases(rng, 400)))
    (out / "learning.json").write_text(json.dumps(learning_cases(rng, 200)))
    (out / "charts.json").write_text(json.dumps(chart_cases(rng, 200)))
    print(f"Wrote fixtures to {out}")


if __name__ == "__main__":
    main()
