"""Editable sentence typing, independent of terminal input and rendering."""
import re
import time
from collections.abc import Callable

SCORING_VERSION = 3
MODE = "editable-sentences"


class TypingState:
    def __init__(self, target: str, clock: Callable[[], float] = time.monotonic):
        if not target or any(ord(c) < 32 or ord(c) > 126 for c in target):
            raise ValueError("Target must be nonempty printable ASCII")
        # The separator belongs to the preceding sentence and must be typed.
        self.target, self.clock = target, clock
        self.boundaries = [m.end() for m in re.finditer(r"[.!?] +", target)]
        if not self.boundaries or self.boundaries[-1] != len(target):
            self.boundaries.append(len(target))
        self.sentence_index = 0
        self.buffer = ""
        self.pending_period = False
        self.period_shortcuts = 0
        self.first_attempts = {}
        self.attempted = self.first_correct = 0
        self.incorrect = self.correct = self.backspaces = 0
        self.word_deletions = self.deleted_characters = 0
        self.combo = self.best_combo = 0
        self.started = self.finished = self.pause_started = None
        self.pause_seconds = 0.0
        self.invalid = False

    @property
    def complete(self):
        return self.finished is not None

    @property
    def position(self):
        """Correct prefix only: deleting and retyping never adds WPM credit."""
        _, start, end = self.sentence()
        count = 0
        for typed, expected in zip(self.buffer, self.target[start:end]):
            if typed != expected:
                break
            count += 1
        return start + count

    @property
    def error(self):
        _, start, end = self.sentence()
        prefix = self.position - start
        return self.buffer[prefix:] if prefix < len(self.buffer) else ""

    def sentence(self):
        index = self.sentence_index
        start = self.boundaries[index - 1] if index else 0
        return index, start, self.boundaries[index]

    def pause(self):
        if self.pause_started is None:
            self.pause_started = self.clock()

    def resume(self):
        if self.pause_started is not None:
            if self.started is not None:
                self.pause_seconds += self.clock() - self.pause_started
            self.pause_started = None

    def feed(self, key: str):
        if self.complete or self.pause_started is not None:
            return
        deletion = key in ("\b", "\x7f", "BACKSPACE", "WORD_BACKSPACE", "\x17")
        printable = len(key) == 1 and key.isprintable()
        if self.pending_period:
            if key == " ":
                self.pending_period = False
                self.period_shortcuts += 1
                self._append_printable(".")
                if not self.complete:
                    self._append_printable(" ")
                else:
                    # Two physical keys produced the final period; no extra WPM credit.
                    self.correct += 1
                return
            if not (deletion or printable):
                return
            # A single space followed by another key is ordinary input, not a shortcut.
            self.pending_period = False
            self._append_printable(" ")
        if deletion:
            before = len(self.buffer)
            if key in ("WORD_BACKSPACE", "\x17"):
                self.word_deletions += 1
                self.buffer = self.buffer.rstrip(" ")
                self.buffer = self.buffer[:self.buffer.rfind(" ") + 1]
            else:
                self.backspaces += 1
                self.buffer = self.buffer[:-1]
            self.deleted_characters += before - len(self.buffer)
            self.combo = 0
            return
        if not printable:
            return
        if self.started is None:
            self.started = self.clock()
        _, start, end = self.sentence()
        cursor = start + len(self.buffer)
        if key == " " and not self.error and self.target[cursor:end].rstrip(" ") == ".":
            self.pending_period = True
            return
        self._append_printable(key)

    def _append_printable(self, key):
        _, start, end = self.sentence()
        cursor = start + len(self.buffer)
        correct = cursor < end and key == self.target[cursor]
        if cursor < end and cursor not in self.first_attempts:
            self.first_attempts[cursor] = correct
            self.attempted += 1
            self.first_correct += int(correct)
        self.buffer += key
        if correct:
            self.correct += 1
            self.combo += 1
            self.best_combo = max(self.best_combo, self.combo)
        else:
            self.incorrect += 1
            self.combo = 0
        if self.buffer == self.target[start:end]:
            if self.sentence_index == len(self.boundaries) - 1:
                self.finished = self.clock()
            else:
                self.sentence_index += 1
                self.buffer = ""

    def metrics(self):
        end = self.finished if self.finished is not None else self.clock()
        pause = self.pause_seconds
        if self.pause_started is not None and self.started is not None:
            pause += end - self.pause_started
        duration = max(0.0, end - self.started - pause) if self.started is not None else 0.0
        accepted = self.position
        return {
            "active_duration": duration, "target_count": len(self.target),
            "accepted_count": accepted, "first_correct": self.first_correct,
            "attempted_count": self.attempted, "incorrect_attempts": self.incorrect,
            "correct_attempts": self.correct, "backspaces": self.backspaces,
            "word_deletions": self.word_deletions, "deleted_characters": self.deleted_characters,
            "period_shortcuts": self.period_shortcuts, "pending_attempts": int(self.pending_period),
            "pause_duration": pause, "best_combo": self.best_combo,
            "wpm": accepted * 12 / duration if duration > 0 and not self.invalid else None,
            "accuracy": 100 * self.first_correct / self.attempted if self.attempted else None,
            "scoring_version": SCORING_VERSION, "typing_mode": MODE,
            "invalid": self.invalid,
        }
