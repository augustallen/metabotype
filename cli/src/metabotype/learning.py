"""Pure learning policy. Typing statistics never enter this module."""
from dataclasses import dataclass, field

ALGORITHM_VERSION = 1
WINDOW = 5
DAY = 86400
LEVELS = {1: "Recognize", 2: "Explain", 3: "Apply", 4: "Evaluate"}


@dataclass
class LearningState:
    level: int = 1
    window: list = field(default_factory=list)
    wrong_streak: int = 0


def update(state: LearningState, question_id: str, level: int, outcome: str,
           eligible: bool) -> tuple[LearningState, str]:
    result = LearningState(state.level, list(state.window), state.wrong_streak)
    if not eligible or level != state.level or outcome == "skipped":
        return result, "Review practice; difficulty unchanged."
    if question_id in [x[0] for x in result.window]:
        return result, "Repeated question; difficulty unchanged."
    correct = outcome == "correct"
    result.window = (result.window + [[question_id, correct]])[-WINDOW:]
    result.wrong_streak = 0 if correct else result.wrong_streak + 1
    reason = "Answer recorded."
    if result.wrong_streak >= 2:
        result.level = max(1, result.level - 1)
        result.window, result.wrong_streak = [], 0
        reason = "Two misses: a little reinforcement before the next climb."
    elif (result.level < 4 and len(result.window) == WINDOW
          and sum(x[1] for x in result.window) >= 4
          and all(x[1] for x in result.window[-2:])):
        result.level += 1
        result.window, result.wrong_streak = [], 0
        reason = f"Level up! Five distinct questions, four correct, last two correct."
    return result, reason


def review_after(previous: dict | None, outcome: str, now: float,
                 can_clear: bool) -> tuple[int, float] | None:
    """Stages: 0 immediate, 1 one-day check, 2 seven-day check, 3 settled."""
    if outcome != "correct":
        return 0, now
    if not can_clear:
        return None
    if previous is None or previous["stage"] == 0:
        return 1, now + DAY
    if previous["due"] > now or previous["stage"] == 3:
        return None
    if previous["stage"] == 1:
        return 2, now + 7 * DAY
    return 3, now
