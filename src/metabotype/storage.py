"""Transactional local history; no keystroke traces are persisted."""
import csv
import fcntl
import json
import os
import sqlite3
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from statistics import median

from . import __version__
from .learning import ALGORITHM_VERSION, LearningState, review_after, update
from .typing import MODE, SCORING_VERSION

SCHEMA = """
CREATE TABLE sessions(id TEXT PRIMARY KEY, started REAL NOT NULL, ended REAL, app_version TEXT NOT NULL);
CREATE TABLE rounds(
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
 topic TEXT NOT NULL, concept TEXT NOT NULL, passage_id TEXT NOT NULL, passage_version INTEGER NOT NULL,
 started REAL NOT NULL, completed REAL, status TEXT NOT NULL, typing_status TEXT NOT NULL,
 kind TEXT NOT NULL, repeated INTEGER NOT NULL, metrics TEXT, reason TEXT NOT NULL);
CREATE TABLE questions(
 round_id TEXT PRIMARY KEY REFERENCES rounds(id), question_id TEXT NOT NULL, question_version INTEGER NOT NULL,
 level INTEGER NOT NULL, option_order TEXT NOT NULL, shown REAL NOT NULL, selected TEXT,
 outcome TEXT NOT NULL, duration REAL, eligible INTEGER NOT NULL, evidence_kind TEXT NOT NULL);
CREATE TABLE learning(topic TEXT PRIMARY KEY, level INTEGER NOT NULL, window TEXT NOT NULL,
 wrong_streak INTEGER NOT NULL, last_practiced REAL NOT NULL);
CREATE TABLE reviews(concept TEXT PRIMARY KEY, topic TEXT NOT NULL, stage INTEGER NOT NULL, due REAL NOT NULL);
CREATE TABLE exposure(concept TEXT PRIMARY KEY, encountered REAL NOT NULL);
CREATE TABLE transitions(id INTEGER PRIMARY KEY, topic TEXT NOT NULL, previous_level INTEGER NOT NULL,
 new_level INTEGER NOT NULL, round_id TEXT NOT NULL REFERENCES rounds(id), reason TEXT NOT NULL,
 algorithm_version INTEGER NOT NULL, created REAL NOT NULL);
CREATE INDEX question_history ON questions(question_id, shown);
CREATE INDEX round_history ON rounds(started);
PRAGMA user_version = 1;
"""


def data_directory():
    base = os.environ.get("XDG_DATA_HOME", "")
    return (Path(base) if base and Path(base).is_absolute() else Path.home() / ".local/share") / "metabotype"


class Storage:
    def __init__(self, directory=None, clock=time.time):
        self.clock = clock
        self.directory = Path(directory) if directory else data_directory()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.lock = (self.directory / "history.lock").open("a")
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self.lock.close()
            raise RuntimeError("This data directory is already open in another Metabotype process.") from None
        try:
            self.db = sqlite3.connect(self.directory / "history.sqlite3")
            self.db.row_factory = sqlite3.Row
            self.db.execute("PRAGMA foreign_keys = ON")
            version = self.db.execute("PRAGMA user_version").fetchone()[0]
            if version == 0:
                self.db.executescript("BEGIN;" + SCHEMA + "COMMIT;")
            elif version != 1:
                raise RuntimeError(f"Unsupported database version {version}; history was not changed.")
        except Exception:
            if hasattr(self, "db"):
                self.db.close()
            self.lock.close()
            raise
        self.session = None

    def close(self):
        if self.session:
            with self.db:
                self.db.execute("UPDATE sessions SET ended=? WHERE id=?", (self.clock(), self.session))
        self.db.close()
        self.lock.close()

    def start_session(self):
        now = self.clock()
        with self.db:
            recovered = self.db.execute("SELECT count(*) FROM rounds WHERE status IN ('typing','quiz')").fetchone()[0]
            self.db.execute("UPDATE rounds SET status='interrupted', typing_status=CASE WHEN typing_status='active' THEN 'partial' ELSE typing_status END WHERE status IN ('typing','quiz')")
            self.db.execute("UPDATE questions SET outcome='unanswered' WHERE outcome='pending'")
            self.db.execute("UPDATE sessions SET ended=? WHERE ended IS NULL", (now,))
            self.session = str(uuid.uuid4())
            self.db.execute("INSERT INTO sessions VALUES(?,?,NULL,?)", (self.session, now, __version__))
        return recovered

    def state(self, topic):
        row = self.db.execute("SELECT * FROM learning WHERE topic=?", (topic,)).fetchone()
        return LearningState(row["level"], json.loads(row["window"]), row["wrong_streak"]) if row else LearningState()

    def encountered(self):
        return {r[0] for r in self.db.execute("SELECT concept FROM exposure")}

    def question_seen(self):
        return {r[0]: r[1] for r in self.db.execute("SELECT question_id, MAX(shown) FROM questions GROUP BY question_id")}

    def reviews(self, due_only=False):
        rows = self.db.execute("SELECT * FROM reviews WHERE stage<3 ORDER BY stage=0 DESC, due").fetchall()
        return [dict(r) for r in rows if not due_only or r["due"] <= self.clock()]

    def begin_round(self, passage, reason):
        if not self.session:
            raise RuntimeError("Start a session first")
        rid = str(uuid.uuid4())
        repeated = self.db.execute("SELECT 1 FROM rounds WHERE passage_id=? AND typing_status='complete'", (passage["id"],)).fetchone() is not None
        with self.db:
            self.db.execute("INSERT INTO rounds VALUES(?,?,?,?,?,?,?,NULL,'typing','active',?,?,NULL,?)",
                            (rid, self.session, passage["topic"], passage["concepts"][0], passage["id"],
                             passage["version"], self.clock(), "practice", int(repeated), reason))
        return rid, repeated

    def save_typing(self, rid, metrics, passage, complete=False, aborted=False):
        typing_status = "complete" if complete else "partial" if aborted else "active"
        status = "aborted" if aborted else "quiz" if complete else "typing"
        with self.db:
            current = self.db.execute("SELECT status FROM rounds WHERE id=?", (rid,)).fetchone()
            if not current or current["status"] != "typing":
                return
            self.db.execute("UPDATE rounds SET metrics=?,typing_status=?,status=?,completed=? WHERE id=?",
                            (json.dumps(metrics), typing_status, status, self.clock() if complete else None, rid))
            if complete:
                for concept in passage["concepts"]:
                    self.db.execute("INSERT OR IGNORE INTO exposure VALUES(?,?)", (concept, self.clock()))

    def show_question(self, rid, question, order, evidence_kind):
        with self.db:
            self.db.execute("INSERT INTO questions VALUES(?,?,?,?,?,?,NULL,'pending',NULL,?,?)",
                            (rid, question["id"], question["version"], question["level"], json.dumps(order),
                             self.clock(), int(evidence_kind != "review"), evidence_kind))

    def answer(self, rid, question, selected, duration):
        if selected is not None and selected not in {o["id"] for o in question["options"]}:
            raise ValueError("Unknown answer option")
        outcome = "skipped" if selected is None else "correct" if selected == question["correct"] else "wrong"
        now = self.clock()
        with self.db:
            saved = self.db.execute("SELECT * FROM questions WHERE round_id=?", (rid,)).fetchone()
            if not saved or saved["outcome"] != "pending":
                raise ValueError("Question has already been answered or was never shown")
            if saved["question_id"] != question["id"]:
                raise ValueError("Answer does not match presented question")
            previous = self.state(question["topic"])
            state, reason = update(previous, question["id"], question["level"], outcome, bool(saved["eligible"]))
            self.db.execute("UPDATE questions SET selected=?,outcome=?,duration=? WHERE round_id=?",
                            (selected, outcome, max(0.0, duration), rid))
            self.db.execute("INSERT INTO learning VALUES(?,?,?,?,?) ON CONFLICT(topic) DO UPDATE SET level=excluded.level,window=excluded.window,wrong_streak=excluded.wrong_streak,last_practiced=excluded.last_practiced",
                            (question["topic"], state.level, json.dumps(state.window), state.wrong_streak, now))
            rev = self.db.execute("SELECT * FROM reviews WHERE concept=?", (question["concept"],)).fetchone()
            change = review_after(dict(rev) if rev else None, outcome, now, bool(saved["eligible"]))
            if change:
                self.db.execute("INSERT INTO reviews VALUES(?,?,?,?) ON CONFLICT(concept) DO UPDATE SET stage=excluded.stage,due=excluded.due",
                                (question["concept"], question["topic"], *change))
            self.db.execute("INSERT INTO transitions(topic,previous_level,new_level,round_id,reason,algorithm_version,created) VALUES(?,?,?,?,?,?,?)",
                            (question["topic"], previous.level, state.level, rid, reason, ALGORITHM_VERSION, now))
            self.db.execute("UPDATE rounds SET status='complete' WHERE id=?", (rid,))
        return outcome, reason, state

    def abandon_quiz(self, rid):
        with self.db:
            self.db.execute("UPDATE rounds SET status='aborted' WHERE id=? AND status='quiz'", (rid,))
            self.db.execute("UPDATE questions SET outcome='unanswered' WHERE round_id=? AND outcome='pending'", (rid,))

    def rounds(self, topic=None, repeat=None, kind=None, days=None):
        rows = self.db.execute("SELECT r.*,q.question_id,q.level,q.outcome FROM rounds r LEFT JOIN questions q ON q.round_id=r.id ORDER BY r.started DESC").fetchall()
        today = datetime.fromtimestamp(self.clock()).date()
        result = []
        for row in rows:
            r = dict(row)
            if topic and r["topic"] != topic or kind and r["kind"] != kind:
                continue
            if repeat is not None and bool(r["repeated"]) != repeat:
                continue
            if days and datetime.fromtimestamp(r["started"]).date() < today - timedelta(days=days - 1):
                continue
            r["metrics"] = json.loads(r["metrics"]) if r["metrics"] else {}
            result.append(r)
        return result

    @staticmethod
    def eligible_rounds(rows):
        return [r for r in rows if r["typing_status"] == "complete" and not r["metrics"].get("invalid")
                and r["metrics"].get("scoring_version") == SCORING_VERSION
                and r["metrics"].get("typing_mode") == MODE and r["metrics"].get("wpm") is not None]

    def summary(self, **filters):
        filters.setdefault("kind", "practice")
        rows = self.eligible_rounds(self.rounds(**filters))
        speeds = [r["metrics"]["wpm"] for r in rows]
        return {"count": len(rows), "best": max(speeds) if speeds else None,
                "median": median(speeds[:10]) if speeds else None,
                "change": median(speeds[:10]) - median(speeds[10:20]) if len(speeds) >= 20 else None}

    def history_days(self, topic=None, days=30):
        """Resolve a fixed range or all-time (None), shared by both graphs."""
        if days is not None:
            if not isinstance(days, int) or days < 1:
                raise ValueError("History range must be a positive day count or None")
            return days
        now = self.clock()
        first = self.db.execute(
            "SELECT MIN(stamp) FROM ("
            "SELECT started AS stamp FROM rounds WHERE kind='practice' AND started<=? "
            "AND (? IS NULL OR topic=?) UNION ALL "
            "SELECT t.created AS stamp FROM transitions t JOIN rounds r ON r.id=t.round_id "
            "WHERE r.kind='practice' AND t.algorithm_version=? AND t.created<=? "
            "AND (? IS NULL OR t.topic=?))",
            (now, topic, topic, ALGORITHM_VERSION, now, topic, topic),
        ).fetchone()[0]
        if first is None:
            return 30
        return (datetime.fromtimestamp(now).date() - datetime.fromtimestamp(first).date()).days + 1

    def daily(self, days=30, **filters):
        filters.setdefault("kind", "practice")
        days = self.history_days(filters.get("topic"), days)
        rows = self.eligible_rounds(self.rounds(**filters))
        today = datetime.fromtimestamp(self.clock()).date()
        buckets = {}
        for r in rows:
            day = datetime.fromtimestamp(r["started"]).date()
            buckets.setdefault(day, []).append(r["metrics"])
        result = []
        for offset in range(days - 1, -1, -1):
            day = today - timedelta(days=offset)
            values = buckets.get(day, [])
            result.append((str(day), median(v["wpm"] for v in values) if values else None,
                           median(v["accuracy"] for v in values) if values else None, len(values)))
        return result

    def understanding_daily(self, topic, days=30):
        """End-of-day topic level, carried forward only after first assessment.

        Use the recorded transition time, not today's learning state or the
        round start time. Reconstruct earlier history to seed the visible range.
        """
        today = datetime.fromtimestamp(self.clock()).date()
        days = self.history_days(topic, days)
        events = self.db.execute(
            "SELECT t.created,t.new_level FROM transitions t "
            "JOIN rounds r ON r.id=t.round_id "
            "WHERE t.topic=? AND t.algorithm_version=? AND r.kind='practice' "
            "AND t.created<=? ORDER BY t.created,t.id",
            (topic, ALGORITHM_VERSION, self.clock()),
        ).fetchall()
        events = [(datetime.fromtimestamp(r["created"]).date(), r["new_level"]) for r in events]
        level, index = None, 0
        result = []
        for offset in range(days - 1, -1, -1):
            day = today - timedelta(days=offset)
            while index < len(events) and events[index][0] <= day:
                level = events[index][1]
                index += 1
            result.append((str(day), level))
        return result

    def export(self, directory):
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True)
        # Exclusive creation avoids overwriting an existing export.
        created = []
        try:
            for table, name in (("rounds", "rounds.csv"), ("questions", "question_attempts.csv")):
                rows = [dict(r) for r in self.db.execute(f"SELECT * FROM {table}")]
                fields = [r[1] for r in self.db.execute(f"PRAGMA table_info({table})")]
                if table == "rounds":
                    metric_fields = sorted({k for r in rows for k in json.loads(r["metrics"] or "{}")})
                    fields = [f for f in fields if f != "metrics"] + metric_fields
                    for r in rows:
                        r.update(json.loads(r.pop("metrics") or "{}"))
                path = directory / name
                with path.open("x", newline="", encoding="utf-8") as stream:
                    created.append(path)
                    writer = csv.DictWriter(stream, fieldnames=fields)
                    writer.writeheader()
                    writer.writerows(rows)
        except Exception:
            for path in created:
                path.unlink()
            raise
        return created
