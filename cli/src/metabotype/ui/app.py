"""A compact field lab that remains usable at 80 x 24."""
import curses
import random
import textwrap
import time
from datetime import datetime
from math import ceil, floor

from ..learning import LEVELS
from ..practice import recommend
from ..typing import TypingState
from .input import Keyboard
from .charts import chart_rows, compact_series

MIN_WIDTH, MIN_HEIGHT = 80, 24
HISTORY_RANGES = [("30 days", 30), ("90 days", 90), ("1 year", 365), ("All time", None)]
LOGO = [r"  m e t a b o t y p e", "  SMALL MOLECULES. STEADY FINGERS."]


def metric(value, suffix=""):
    return "--" if value is None else f"{value:.1f}{suffix}"


class App:
    def __init__(self, screen, content, storage, no_color=False):
        self.screen, self.content, self.storage = screen, content, storage
        self.keyboard = Keyboard(screen)
        self.rng = random.Random()
        self.topic = None
        self.review_streak = 0
        self.history_range = 0
        self.colors = {}
        self.notice = ""
        screen.timeout(50)
        screen.keypad(True)
        # Keypad decoding has a separate Escape delay (normally one second).
        # Keep a short window for arrow and modifier sequences without lagging.
        curses.set_escdelay(25)
        try:
            curses.curs_set(0)
        except curses.error:
            pass
        if not no_color and curses.has_colors():
            curses.start_color()
            try:
                curses.use_default_colors()
                background = -1
            except curses.error:
                background = curses.COLOR_BLACK
            palette = {"teal": curses.COLOR_CYAN, "green": curses.COLOR_GREEN,
                       "gold": curses.COLOR_YELLOW, "red": curses.COLOR_RED, "muted": curses.COLOR_BLUE}
            for i, (name, color) in enumerate(palette.items(), 1):
                curses.init_pair(i, color, background)
                self.colors[name] = curses.color_pair(i)

    def style(self, name="", bold=False):
        return self.colors.get(name, 0) | (curses.A_BOLD if bold else 0)

    def put(self, y, x, text, attr=0):
        h, w = self.screen.getmaxyx()
        if 0 <= y < h and 0 <= x < w - 1:
            try:
                self.screen.addnstr(y, x, str(text), w - x - 1, attr)
            except curses.error:
                pass

    def center(self, y, text, attr=0):
        self.put(y, max(0, (self.w - len(text)) // 2), text, attr)

    def frame(self, title, footer="[Esc] Home    [F1] Field guide"):
        self.h, self.w = self.screen.getmaxyx()
        self.left = max(3, (self.w - 88) // 2)
        self.width = min(88, self.w - self.left * 2)
        self.screen.erase()
        self.put(1, self.left, "m / metabotype", self.style("teal", True))
        self.put(3, self.left, title.upper(), curses.A_BOLD)
        self.put(4, self.left, "-" * self.width, self.style("muted"))
        self.put(self.h - 3, self.left, "-" * self.width, self.style("muted"))
        self.put(self.h - 2, self.left, footer, self.style("teal"))

    def usable(self):
        h, w = self.screen.getmaxyx()
        return w >= MIN_WIDTH and h >= MIN_HEIGHT

    def wait_size(self, typing=None):
        if self.usable():
            return True
        if typing:
            typing.pause()
        while not self.usable():
            self.screen.erase()
            h, w = self.screen.getmaxyx()
            self.put(max(0, h // 2 - 1), 0, "Lab paused. Resize to 80 x 24.", curses.A_BOLD)
            self.put(max(0, h // 2 + 1), 0, f"Now {w} x {h}.  Esc: leave round")
            self.screen.refresh()
            if self.keyboard.get() in ("ESC", "q", "Q"):
                return False
        if typing:
            typing.resume()
        return True

    def page(self, title, lines, footer=None):
        offset = 0
        while True:
            if not self.wait_size():
                return "ESC"
            self.frame(title, footer or "[Up/Down] Scroll    [Esc / Enter] Back")
            wrapped = []
            for line in lines:
                wrapped.extend(textwrap.wrap(line, self.width, replace_whitespace=False) or [""])
            capacity = self.h - 9
            offset = min(offset, max(0, len(wrapped) - capacity))
            for i, line in enumerate(wrapped[offset:offset + capacity]):
                self.put(6 + i, self.left, line)
            if len(wrapped) > capacity:
                self.put(self.h - 4, self.left, f"{offset + 1}-{min(offset + capacity, len(wrapped))} / {len(wrapped)} lines", self.style("gold"))
            self.screen.refresh()
            key = self.keyboard.get()
            if key in ("ESC", "ENTER", "q", "Q"):
                return key
            if key in (curses.KEY_DOWN, "j"):
                offset = min(max(0, len(wrapped) - capacity), offset + 1)
            if key in (curses.KEY_UP, "k"):
                offset = max(0, offset - 1)
            if key == curses.KEY_NPAGE:
                offset += capacity
            if key == curses.KEY_PPAGE:
                offset = max(0, offset - capacity)

    def help(self):
        self.page("Help", [
            "Type the passage, then answer a question.", "",
            "The highlighted character is next. Spaces are ordinary spaces.",
            "Backspace erases a character. Option/Alt+Backspace erases a word.",
            "Ctrl+W also erases a word. Delete mistakes before retyping them.",
            "Type the space after each sentence to continue to the next one.",
            "Double-space can also type the final period and its following space.",
            "Esc pauses. F1 opens help. Both pause your typing timer.", "",
            "WPM measures typing speed. Accuracy counts first tries.",
            "Question difficulty follows understanding, never typing speed.",
            "Immediate repeats are practice only; delayed reviews can count.", "",
            "Notebook: Left/Right changes the time range; Tab changes topic.",
            "Progress saves automatically.",
        ])

    def home(self):
        selected = 0
        items = [("p", "Play"), ("t", "Topics"), ("h", "Field notebook")]
        while True:
            if not self.wait_size():
                return
            self.frame("Metabotype", "[Enter] Select    [?] Help    [Q] Quit")
            self.put(7, self.left, LOGO[1].strip(), self.style("teal", True))
            for i, (shortcut, title) in enumerate(items):
                active = i == selected
                label = f"{'>' if active else ' '} [{shortcut.upper()}] {title}"
                self.put(11 + i * 2, self.left, label,
                         self.style("teal", active) | (curses.A_REVERSE if active else 0))
            if self.notice:
                self.put(self.h - 4, self.left, self.notice)
            self.screen.refresh()
            key = self.keyboard.get()
            if key in ("q", "Q", "ESC"):
                return
            if key in ("?", "HELP"):
                self.help()
            if key in (curses.KEY_DOWN, "j"):
                selected = (selected + 1) % len(items)
            if key in (curses.KEY_UP, "k"):
                selected = (selected - 1) % len(items)
            choice = items[selected][0] if key == "ENTER" else key.lower() if isinstance(key, str) else None
            if choice in ("p", "t", "h"):
                self.notice = ""
            if choice == "p":
                self.play()
            elif choice == "t":
                self.topics()
            elif choice == "h":
                self.history()

    def topics(self):
        ids = list(self.content.topics)
        selected = ids.index(self.topic) if self.topic else 0
        while True:
            if not self.wait_size():
                return
            self.frame("Topics", "[Up/Down] Choose    [Enter] Play    [Esc] Back")
            for i, tid in enumerate(ids):
                topic = self.content.topics[tid]
                state = self.storage.state(tid)
                y = 8 + i * 5
                self.put(y, self.left, f"{'>' if i == selected else ' '} {topic['title']}", self.style("teal", True))
                self.put(y + 1, self.left + 2, f"Level {state.level} / {LEVELS[state.level]}", self.style("gold"))
            self.screen.refresh()
            key = self.keyboard.get()
            if key in ("ESC", "q", "Q"):
                return
            if key in (curses.KEY_DOWN, "j"):
                selected = (selected + 1) % len(ids)
            if key in (curses.KEY_UP, "k"):
                selected = (selected - 1) % len(ids)
            if key in tuple(str(i + 1) for i in range(len(ids))):
                selected = int(key) - 1
            if key == "ENTER":
                self.topic = ids[selected]
                self.play()
                return
            if key in ("?", "HELP"):
                self.help()

    def pause(self, typing):
        typing.pause()
        while True:
            if not self.wait_size():
                return False
            self.frame("Paused", "[Enter / Esc] Resume    [Q] Leave round")
            self.center(11, "Take your time.", self.style("teal", True))
            self.screen.refresh()
            key = self.keyboard.get()
            if key in ("ENTER", "ESC"):
                typing.resume()
                return True
            if key in ("q", "Q"):
                return False
            if key in ("HELP", "?"):
                self.help()

    def type_passage(self, rid, passage):
        state = TypingState(passage["text"])
        try:
            while not state.complete:
                if not self.wait_size(state):
                    self.storage.save_typing(rid, state.metrics(), passage, aborted=True)
                    return None
                self.frame(passage["title"], "[Esc] Pause    [F1] Help")
                m = state.metrics()
                index, start, end = state.sentence()
                self.put(6, self.left, f"Sentence {index + 1} of {len(state.boundaries)}", self.style("gold"))
                live_wpm = m["wpm"] if m["active_duration"] >= 1 else None
                self.put(8, self.left, f"{metric(live_wpm):>6} WPM     {metric(m['accuracy'], '%'):>7} accuracy", self.style("teal", True))
                target = state.target[start:end]
                text = state.buffer + target[len(state.buffer):]
                # Keep an insertion cursor visible even after an overlong typo.
                if len(state.buffer) >= len(target):
                    text += " "
                line_width = self.width - 4
                # Keep words together without dropping any scored separator spaces.
                lines = textwrap.wrap(text, line_width, replace_whitespace=False,
                                      drop_whitespace=False, break_on_hyphens=False)
                cursor_line, offset = 0, 0
                for line_index, line in enumerate(lines):
                    if offset <= len(state.buffer) < offset + len(line):
                        cursor_line = line_index
                    offset += len(line)
                first_line = max(0, cursor_line - 5)
                relative = 0
                for line_index, line in enumerate(lines):
                    for column, char in enumerate(line):
                        attr = curses.A_NORMAL
                        if relative < len(state.buffer):
                            correct = relative < len(target) and char == target[relative]
                            attr = self.style("green") if correct else self.style("red", True) | curses.A_UNDERLINE
                        if relative == len(state.buffer):
                            attr = self.style("red" if state.error else "teal", True) | curses.A_REVERSE | curses.A_UNDERLINE
                        if first_line <= line_index < first_line + 6:
                            self.put(11 + line_index - first_line, self.left + 2 + column, char, attr)
                        relative += 1
                if state.error:
                    self.put(17, self.left, "! Backspace to fix, or Option/Alt+Backspace to erase a word.", self.style("red", True))
                size = self.width - 9
                filled = int(size * state.position / len(state.target))
                self.put(19, self.left, "[" + "=" * filled + " " * (size - filled) + f"] {100 * state.position // len(state.target):>3}%", self.style("teal"))
                self.screen.refresh()
                key = self.keyboard.get()
                if key == "ESC":
                    if not self.pause(state):
                        self.storage.save_typing(rid, state.metrics(), passage, aborted=True)
                        return None
                elif key == "HELP":
                    state.pause()
                    self.help()
                    state.resume()
                elif key == "PASTE":
                    state.invalid = True
                    self.storage.save_typing(rid, state.metrics(), passage, aborted=True)
                    self.page("Paste detected", ["This round will not be scored. Please type the passage."])
                    return None
                elif isinstance(key, str):
                    before = state.sentence_index
                    state.feed(key)
                    if state.sentence_index != before and not state.complete:
                        self.storage.save_typing(rid, state.metrics(), passage)
            self.storage.save_typing(rid, state.metrics(), passage, complete=True)
            return state.metrics()
        except (KeyboardInterrupt, SystemExit):
            self.storage.save_typing(rid, state.metrics(), passage, aborted=True)
            raise

    def quiz(self, rid, question, evidence_kind):
        order = [o["id"] for o in question["options"]]
        self.rng.shuffle(order)
        opts = {o["id"]: o for o in question["options"]}
        self.storage.show_question(rid, question, order, evidence_kind)
        selected = None
        start = time.monotonic()
        offset = 0
        while True:
            if not self.wait_size():
                self.storage.abandon_quiz(rid)
                return None
            self.frame("Question", f"[1-{len(order)}] Select    [Enter] Confirm    [S] Skip    [Esc] Leave")
            label = {"fresh": "", "review": " / Practice only", "reassessment": " / Reassessment"}[evidence_kind]
            self.put(6, self.left, f"{LEVELS[question['level']]}{label}", self.style("gold"))
            lines = textwrap.wrap(question["prompt"], self.width)
            y = 8
            for line in lines:
                self.put(y, self.left, line, curses.A_BOLD)
                y += 1
            y += 1
            for i, oid in enumerate(order):
                active = selected == oid
                text = f"{'>' if active else ' '} [{i + 1}] {opts[oid]['text']}"
                for line in textwrap.wrap(text, self.width, subsequent_indent="      "):
                    self.put(y, self.left, line, self.style("teal", active) | (curses.A_REVERSE if active else 0))
                    y += 1
                y += 1
            self.screen.refresh()
            key = self.keyboard.get()
            if key in tuple(str(n) for n in range(1, len(order) + 1)):
                selected = order[int(key) - 1]
            if key in (curses.KEY_DOWN, curses.KEY_UP):
                offset = (order.index(selected) if selected else -1) + (1 if key == curses.KEY_DOWN else -1)
                selected = order[offset % len(order)]
            if key in ("s", "S") or key == "ENTER" and selected:
                return self.storage.answer(rid, question, None if key in ("s", "S") else selected, time.monotonic() - start)
            if key == "ESC":
                self.storage.abandon_quiz(rid)
                return None
            if key in ("?", "HELP"):
                self.help()

    def results(self, metrics, passage, question, result):
        outcome, _reason, state = result
        answer = next(o["text"] for o in question["options"] if o["id"] == question["correct"])
        title = "Correct!" if outcome == "correct" else "Not quite" if outcome == "wrong" else "Skipped"
        while True:
            if not self.wait_size():
                return "home"
            self.frame(title, "[Enter] Next    [Esc] Home    [?] Details")
            self.put(7, self.left, f"{metric(metrics['wpm'])} WPM    {metric(metrics['accuracy'], '%')} accuracy", self.style("teal", True))
            self.put(10, self.left, f"{LEVELS[state.level]} / Level {state.level}", self.style("gold"))
            lines = textwrap.wrap("Answer: " + answer, self.width)
            lines += [""] + textwrap.wrap(question["explanation"], self.width)
            for i, line in enumerate(lines):
                self.put(12 + i, self.left, line)
            self.screen.refresh()
            key = self.keyboard.get()
            if key == "ENTER":
                return "next"
            if key in ("h", "H", "ESC"):
                return "home"
            if key in ("q", "Q"):
                return "quit"
            if key in ("?", "HELP"):
                refs = {s["id"]: s for s in self.content.data["sources"]}
                details = [question["prompt"], "", "Answer: " + answer, "", question["explanation"], "", passage["text"], "", "Sources:"]
                details += [refs[s]["title"] + " - " + refs[s]["url"] for s in passage["sources"]]
                self.page("Details", details)

    def play(self):
        while True:
            try:
                rec = recommend(self.content, self.storage, topic=self.topic,
                                review_streak=self.review_streak, rng=self.rng)
            except ValueError as exc:
                self.notice = str(exc)
                return
            passage = rec.passage
            rid, _repeated = self.storage.begin_round(passage, rec.reason)
            metrics = self.type_passage(rid, passage)
            if metrics is None:
                return
            result = self.quiz(rid, rec.question, rec.evidence_kind)
            if result is None:
                return
            self.review_streak = self.review_streak + 1 if rec.review else 0
            action = self.results(metrics, passage, rec.question, result)
            if action == "quit":
                raise SystemExit(0)
            if action == "home":
                return

    def notebook_symbols(self):
        try:
            "╭╮╰╯─│┤●⠿←→".encode(getattr(self.screen, "encoding", "utf-8"))
            return True
        except (UnicodeError, LookupError):
            return False

    def draw_chart(self, y, title, values, maximum, minimum=0, step=False,
                   height=8, summary="", detail=""):
        fancy = self.notebook_symbols()
        tl, tr, bl, br, horizontal, vertical = "╭╮╰╯─│" if fancy else "++++-|"
        color = "gold" if step else "teal"
        muted = curses.A_DIM
        self.put(y, self.left, tl + horizontal * (self.width - 2) + tr, muted)
        self.put(y, self.left + 2, f" {title} ", self.style(color, True))
        for row in range(y + 1, y + height - 1):
            self.put(row, self.left, vertical, muted)
            self.put(row, self.left + self.width - 1, vertical, muted)
        self.put(y + height - 1, self.left,
                 bl + horizontal * (self.width - 2) + br, muted)
        self.put(y + 1, self.left + 3, summary, self.style(color, True))
        self.put(y + 1, self.left + self.width - 3 - len(detail), detail, muted)
        plot_height, plot_width = height - 3, self.width - 11
        rows = chart_rows(values, plot_width, plot_height, maximum, minimum, step, fancy)
        ticks = [minimum + i * (maximum - minimum) / (3 if step else 2)
                 for i in range(4 if step else 3)]
        labels = {plot_height - 1 - round((v - minimum) / (maximum - minimum) * (plot_height - 1)): v
                  for v in ticks}
        for i, row in enumerate(rows):
            label = f"{labels[i]:>4.0f} " if i in labels else "     "
            self.put(y + 2 + i, self.left + 2, label + ("┤" if fancy and i in labels else vertical), muted)
            self.put(y + 2 + i, self.left + 9, row, self.style(color))
        if not any(v is not None for v in values):
            message = "Answer a question to begin" if step else "Play a round to begin"
            self.put(y + 2 + plot_height // 2, self.left + 12, message, muted)

    def draw_notebook(self, topic_title, daily, understanding):
        self.h, self.w = self.screen.getmaxyx()
        self.left = max(3, (self.w - 120) // 2)
        self.width = min(120, self.w - self.left * 2)
        self.screen.erase()
        fancy = self.notebook_symbols()
        self.put(1, self.left, "FIELD NOTEBOOK", curses.A_BOLD)
        self.put(1, self.left + self.width - len(topic_title), topic_title, self.style("teal"))
        x = self.left
        self.put(3, x, "← " if fancy else "< ", curses.A_DIM)
        x += 2
        for i, (range_label, _) in enumerate(HISTORY_RANGES):
            selected = i == self.history_range
            text = f" {range_label} "
            self.put(3, x, text, (curses.A_REVERSE | curses.A_BOLD) if selected else curses.A_DIM)
            x += len(text) + 1
        self.put(3, x, "→" if fancy else ">", curses.A_DIM)
        dates = [r[0] for r in daily]
        columns = self.width - 11
        speeds = compact_series([r[1] for r in daily], columns)
        levels = compact_series([r[1] for r in understanding], columns, step=True)
        grouped = len(daily) > columns
        observed = [v for v in speeds if v is not None]
        minimum = max(0, floor((min(observed, default=0) - 5) / 10) * 10)
        maximum = max(minimum + 10, ceil((max(observed, default=0) + 5) / 10) * 10)
        latest = next((r for r in reversed(daily) if r[1] is not None), None)
        summary = metric(latest[1], " WPM") if latest else "No scores yet"
        detail = f"Latest day: {latest[0]}" if latest else ""
        level = next((r[1] for r in reversed(understanding) if r[1] is not None), None)
        learning_summary = f"Level {level} of 4" if level is not None else "No assessments yet"
        self.put(4, self.left, "Lines connect played days" + ("; points summarize intervals" if grouped else ""), curses.A_DIM)
        available = self.h - 9
        typing_height = max(8, round(available * 0.55))
        learning_height = available - typing_height
        title = "TYPING / interval medians" if grouped else "TYPING / daily medians"
        self.draw_chart(5, title, speeds, maximum, minimum, height=typing_height, summary=summary, detail=detail)
        self.draw_chart(6 + typing_height, "UNDERSTANDING", levels, 4, 1, step=True,
                        height=learning_height, summary=learning_summary,
                        detail=LEVELS.get(level, ""))
        positions = [(0, 0), ((len(dates) - 1) // 2, 1), (len(dates) - 1, 2)]
        if len(dates) < 3:
            positions = [(0, 1)] if len(dates) == 1 else [(0, 0), (1, 2)]
        include_year = dates[0][:4] != dates[-1][:4]
        for pos, n in positions:
            date = datetime.strptime(dates[pos], "%Y-%m-%d")
            text = date.strftime("%b %d '%y" if include_year else "%b %d")
            x = self.left + 9 + round(n * (columns - 1) / 2)
            x -= 0 if n == 0 else len(text) - 1 if n == 2 else len(text) // 2
            self.put(self.h - 3, x, text, curses.A_DIM)
        self.put(self.h - 2, self.left, "[Left/Right] Range    [Tab] Topic    [Enter] Rounds    [Esc] Home", curses.A_DIM)
        self.screen.refresh()

    def history(self):
        topics = list(self.content.topics)
        last = self.storage.db.execute("SELECT topic FROM learning ORDER BY last_practiced DESC LIMIT 1").fetchone()
        current = self.topic or (last[0] if last else topics[0])
        index = topics.index(current) if current in topics else 0
        cached = None
        while True:
            if not self.wait_size():
                return
            tid = topics[index]
            _, days = HISTORY_RANGES[self.history_range]
            cache_key = tid, days, datetime.fromtimestamp(self.storage.clock()).date()
            if cached != cache_key:
                daily = self.storage.daily(topic=tid, days=days)
                understanding = self.storage.understanding_daily(tid, days=days)
                cached = cache_key
            self.draw_notebook(self.content.topics[tid]["title"], daily, understanding)
            # Poll for input and midnight without rebuilding idle charts.
            while (key := self.keyboard.get()) is None:
                if datetime.fromtimestamp(self.storage.clock()).date() != cache_key[2]:
                    break
            if key in ("ESC", "q", "Q"):
                return
            if key in ("\t", "t", "T"):
                index = (index + 1) % len(topics)
            if key == curses.KEY_RIGHT:
                self.history_range = (self.history_range + 1) % len(HISTORY_RANGES)
            if key == curses.KEY_LEFT:
                self.history_range = (self.history_range - 1) % len(HISTORY_RANGES)
            if key == "ENTER":
                self.recent_rounds(tid)
            if key in ("?", "HELP"):
                self.help()

    def recent_rounds(self, topic):
        lines = ["DATE         WPM    ACCURACY    QUESTION", ""]
        for r in self.storage.rounds(topic=topic, kind="practice"):
            m = r["metrics"]
            date = datetime.fromtimestamp(r["started"]).strftime("%m-%d %H:%M")
            scored = r["typing_status"] == "complete" and not m.get("invalid") and m.get("wpm") is not None
            speed = metric(m.get("wpm")) if scored else "--"
            outcome = r["outcome"] or r["status"]
            if scored and not self.storage.eligible_rounds([r]):
                outcome += " (earlier typing rules)"
            lines.append(f"{date}  {speed:>6}  {metric(m.get('accuracy'), '%'):>9}    {outcome}")
        if len(lines) == 2:
            lines.append("No rounds yet.")
        self.page("Recent rounds", lines)



def run(screen, content, storage, no_color=False):
    app = App(screen, content, storage, no_color)
    count = storage.start_session()
    if count:
        app.notice = f"Recovered {count} unfinished round(s). Saved typing results are intact."
    app.home()
