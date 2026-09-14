import copy
import csv
import json
import os
from pathlib import Path
import random
import sqlite3
import sys
import tempfile
import textwrap
import time
import unittest
from unittest.mock import patch
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from metabotype.content import Content, ContentError
from metabotype.learning import DAY, LearningState, review_after, update
from metabotype.practice import recommend
from metabotype.storage import Storage
from metabotype.typing import TypingState


class Clock:
    def __init__(self, now=0):
        self.now = now

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


class TypingTests(unittest.TestCase):
    def test_corrections_and_first_attempt_accuracy(self):
        clock = Clock()
        s = TypingState("ab c", clock)
        s.feed("x")
        clock.advance(1)
        s.feed("\b")
        s.feed("y")
        s.feed("\b")
        s.feed("a")
        clock.advance(1)
        s.feed("b")
        s.feed(" ")
        clock.advance(2)
        s.feed("c")
        m = s.metrics()
        self.assertEqual((m["attempted_count"], m["first_correct"]), (4, 3))
        self.assertEqual((m["incorrect_attempts"], m["correct_attempts"], m["backspaces"]), (2, 4, 2))
        self.assertEqual(m["accuracy"], 75)
        self.assertEqual(m["wpm"], 12)
        self.assertTrue(s.complete)
        clock.advance(100)
        self.assertEqual(s.metrics()["wpm"], 12)

    def test_pauses_exclude_only_paused_time(self):
        clock = Clock()
        s = TypingState("ab", clock)
        s.pause()
        clock.advance(100)
        s.resume()
        s.feed("a")
        clock.advance(1)
        s.pause()
        s.pause()
        clock.advance(60)
        s.feed("b")
        self.assertFalse(s.complete)
        self.assertEqual(s.metrics()["active_duration"], 1)
        s.resume()
        clock.advance(1)
        s.feed("b")
        self.assertEqual(s.metrics()["active_duration"], 2)
        self.assertEqual(s.metrics()["pause_duration"], 60)

    def test_zero_time_and_empty_sample(self):
        s = TypingState("a", Clock())
        self.assertIsNone(s.metrics()["accuracy"])
        s.feed("a")
        self.assertIsNone(s.metrics()["wpm"])

    def test_backspace_removes_correct_text_without_double_counting(self):
        s = TypingState("abc", Clock())
        s.feed("a")
        s.feed("b")
        s.feed("\b")
        self.assertEqual(s.position, 1)
        s.clock.advance(1)
        s.feed("b")
        s.feed("c")
        self.assertTrue(s.complete)
        self.assertEqual(s.metrics()["accepted_count"], 3)
        self.assertEqual(s.metrics()["correct_attempts"], 4)
        self.assertEqual(s.metrics()["accuracy"], 100)
        self.assertEqual(s.metrics()["wpm"], 36)

    def test_sentence_requires_separator_spaces_and_counts_them(self):
        s = TypingState("Hi.  Bye? Yes!")
        for c in "Hi.":
            s.feed(c)
        self.assertEqual(s.sentence(), (0, 0, 5))
        self.assertEqual(s.position, 3)
        s.feed(" ")
        self.assertEqual(s.sentence_index, 0)
        s.feed(" ")
        self.assertEqual(s.sentence(), (1, 5, 10))
        self.assertEqual(s.metrics()["target_count"], 14)
        s.feed("\b")
        s.feed("WORD_BACKSPACE")
        self.assertEqual(s.position, 5)  # Finished sentences stay locked.
        for c in "Bye? Yes!":
            s.feed(c)
        self.assertTrue(s.complete)
        self.assertEqual(s.metrics()["accepted_count"], 14)
        self.assertEqual(s.metrics()["correct_attempts"], 14)
        self.assertEqual(s.metrics()["accuracy"], 100)

    def test_mistakes_cannot_be_overwritten_with_correct_key(self):
        s = TypingState("abc")
        s.feed("x")
        s.feed("a")
        self.assertEqual(s.buffer, "xa")
        self.assertEqual(s.position, 0)
        s.feed("\b")
        self.assertEqual(s.buffer, "x")
        s.feed("\b")
        for c in "abc":
            s.feed(c)
        self.assertTrue(s.complete)
        self.assertAlmostEqual(s.metrics()["accuracy"], 100 / 3)
        self.assertEqual(s.metrics()["incorrect_attempts"], 2)

    def test_double_space_enters_period_and_separator(self):
        s = TypingState("Hi. Bye.", Clock())
        for c in "Hi":
            s.feed(c)
        s.feed(" ")
        self.assertEqual(s.sentence_index, 0)
        self.assertEqual(s.position, 2)
        self.assertEqual(s.metrics()["pending_attempts"], 1)
        s.clock.advance(1)
        s.feed(" ")
        self.assertEqual(s.sentence_index, 1)
        self.assertEqual(s.position, 4)
        for c in "Bye  ":
            s.feed(c)
        self.assertTrue(s.complete)
        self.assertEqual(s.metrics()["accepted_count"], 8)
        self.assertEqual(s.metrics()["correct_attempts"], 9)
        self.assertEqual(s.metrics()["period_shortcuts"], 2)
        self.assertEqual(s.metrics()["accuracy"], 100)
        self.assertEqual(s.metrics()["incorrect_attempts"], 0)
        self.assertEqual(s.metrics()["wpm"], 96)

    def test_double_space_does_not_replace_other_punctuation_or_fix_errors(self):
        for target, text in [("Hi? Bye.", "Hi  "), ("Hi. Bye.", "Hx  "), ("Hi  there.", "Hi  ")]:
            s = TypingState(target)
            for c in text:
                s.feed(c)
            self.assertEqual(s.metrics()["period_shortcuts"], 0)
            self.assertEqual(s.buffer, text)

    def test_incomplete_shortcut_is_literal_input_and_requires_deletion(self):
        s = TypingState("Hi.")
        for c in "Hi x":
            s.feed(c)
        self.assertEqual(s.buffer, "Hi x")
        self.assertEqual(s.metrics()["incorrect_attempts"], 2)
        s.feed("BACKSPACE")
        s.feed("BACKSPACE")
        s.feed(".")
        self.assertTrue(s.complete)
        self.assertAlmostEqual(s.metrics()["accuracy"], 200 / 3)

    def test_word_delete_cancels_pending_shortcut_and_pause_preserves_it(self):
        s = TypingState("Hi.")
        for c in "Hi ":
            s.feed(c)
        s.pause()
        s.feed(" ")
        self.assertTrue(s.pending_period)
        s.resume()
        s.feed("WORD_BACKSPACE")
        self.assertFalse(s.pending_period)
        self.assertEqual(s.buffer, "")
        self.assertEqual(s.metrics()["deleted_characters"], 3)

    def test_word_delete_rewinds_to_start_and_preserves_first_attempt_errors(self):
        s = TypingState("alpha beta gamma.")
        for c in "alpha bexa":
            s.feed(c)
        self.assertTrue(s.error)
        s.feed("WORD_BACKSPACE")
        self.assertEqual(s.buffer, "alpha ")
        self.assertFalse(s.error)
        for c in "beta gamma.":
            s.feed(c)
        self.assertTrue(s.complete)
        m = s.metrics()
        self.assertEqual(m["word_deletions"], 1)
        self.assertEqual(m["deleted_characters"], 4)
        self.assertEqual(m["first_correct"], len(s.target) - 1)
        self.assertGreater(m["correct_attempts"], m["accepted_count"])

    def test_word_delete_with_trailing_spaces_empty_buffer_and_pause(self):
        s = TypingState("one two three.")
        for c in "one two ":
            s.feed(c)
        s.feed("\x17")
        self.assertEqual(s.buffer, "one ")
        s.feed("WORD_BACKSPACE")
        s.feed("WORD_BACKSPACE")
        self.assertEqual(s.buffer, "")
        s.feed("o")
        s.pause()
        s.feed("WORD_BACKSPACE")
        self.assertEqual(s.buffer, "o")

    def test_wrong_sentence_cannot_advance_and_overflow_must_be_deleted(self):
        s = TypingState("Hi. Bye.")
        for c in "Hx.extra":
            s.feed(c)
        self.assertEqual(s.sentence_index, 0)
        s.feed("WORD_BACKSPACE")
        for c in "Hi. ":
            s.feed(c)
        self.assertEqual(s.sentence_index, 1)
        self.assertLessEqual(s.first_correct, s.attempted)

    def test_nontext_ignored_and_invalid_paste_unscored(self):
        s = TypingState("ab", Clock())
        s.feed("ENTER")
        self.assertEqual(s.attempted, 0)
        s.feed("a")
        s.invalid = True
        s.clock.advance(1)
        s.feed("b")
        self.assertIsNone(s.metrics()["wpm"])


class LearningTests(unittest.TestCase):
    def sequence(self, outcomes, state=None):
        state = state or LearningState()
        for index, outcome in enumerate(outcomes):
            state, reason = update(state, str(index), state.level, outcome, True)
        return state

    def test_promotion_requires_five_distinct_and_latest_two(self):
        self.assertEqual(self.sequence(["correct"] * 4).level, 1)
        self.assertEqual(self.sequence(["correct", "wrong", "correct", "correct", "correct"]).level, 2)
        self.assertEqual(self.sequence(["correct"] * 4 + ["wrong"]).level, 1)
        self.assertEqual(self.sequence(["correct"] * 4 + ["wrong", "correct", "correct"]).level, 2)

    def test_demotion_reset_and_floor(self):
        state = self.sequence(["wrong", "wrong"], LearningState(3))
        self.assertEqual((state.level, state.window, state.wrong_streak), (2, [], 0))
        self.assertEqual(self.sequence(["wrong", "wrong"]).level, 1)

    def test_promotion_cannot_cascade(self):
        state = self.sequence(["correct"] * 5)
        self.assertEqual(state.window, [])
        state, _ = update(state, "new", 2, "correct", True)
        self.assertEqual(state.level, 2)

    def test_repeats_skips_and_other_levels_preserve_streak(self):
        state = self.sequence(["wrong"])
        for eligible, level, outcome in [(False, 1, "correct"), (True, 1, "skipped"), (True, 2, "wrong")]:
            new, _ = update(state, "new", level, outcome, eligible)
            self.assertEqual(new, state)
        repeated, _ = update(state, "0", 1, "correct", True)
        self.assertEqual(repeated, state)

    def test_ceiling(self):
        self.assertEqual(self.sequence(["correct"] * 10, LearningState(4)).level, 4)

    def test_retention_and_early_review(self):
        self.assertEqual(review_after(None, "correct", 0, True), (1, DAY))
        self.assertEqual(review_after(None, "wrong", 2, False), (0, 2))
        self.assertIsNone(review_after({"stage": 0, "due": 0}, "correct", 3, False))
        self.assertIsNone(review_after({"stage": 1, "due": DAY}, "correct", 3, True))
        self.assertEqual(review_after({"stage": 1, "due": DAY}, "correct", DAY, True), (2, 8 * DAY))
        self.assertEqual(review_after({"stage": 2, "due": 8 * DAY}, "correct", 8 * DAY, True), (3, 8 * DAY))
        self.assertEqual(review_after({"stage": 2, "due": 8 * DAY}, "skipped", 8 * DAY, True), (0, 8 * DAY))


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.clock = Clock(1789200000)
        self.store = Storage(self.tmp.name, self.clock)
        self.store.start_session()
        self.content = Content()
        self.p = self.content.passages["p-molecules"]
        self.q = self.content.questions["q-molecules-1"]

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def typed(self, passage=None, duration=60):
        p = passage or self.p
        rid, _ = self.store.begin_round(p, "test")
        timer = Clock()
        s = TypingState(p["text"], timer)
        s.feed(s.target[0])
        timer.advance(duration)
        for c in s.target[1:]:
            s.feed(c)
        self.store.save_typing(rid, s.metrics(), p, complete=True)
        return rid

    def test_interrupted_quiz_preserves_typing_and_exposure(self):
        rid = self.typed()
        self.store.show_question(rid, self.q, ["c", "a", "b"], "fresh")
        self.store.close()
        self.store = Storage(self.tmp.name, self.clock)
        self.assertEqual(self.store.start_session(), 1)
        row = self.store.rounds()[0]
        self.assertEqual(row["status"], "interrupted")
        self.assertEqual(row["typing_status"], "complete")
        self.assertEqual(row["outcome"], "unanswered")
        self.assertEqual(self.store.summary()["count"], 1)
        self.assertIn("molecules", self.store.encountered())
        self.assertEqual(self.store.state("foundations"), LearningState())

    def test_checkpoint_recovery_is_partial_and_unscored(self):
        rid, _ = self.store.begin_round(self.p, "test")
        timer = Clock()
        s = TypingState(self.p["text"], timer)
        for c in s.target[:42]:
            s.feed(c)
            timer.advance(0.1)
        self.store.save_typing(rid, s.metrics(), self.p)
        self.store.start_session()
        row = self.store.rounds()[0]
        self.assertEqual(row["metrics"]["accepted_count"], 42)
        self.assertEqual(row["typing_status"], "partial")
        self.assertEqual(self.store.summary()["count"], 0)
        self.assertNotIn("molecules", self.store.encountered())

    def test_answer_is_atomic_and_cannot_apply_twice(self):
        rid = self.typed()
        self.store.show_question(rid, self.q, ["b", "a", "c"], "fresh")
        outcome, _, _ = self.store.answer(rid, self.q, "a", 3)
        self.assertEqual(outcome, "correct")
        self.assertEqual(self.store.state("foundations").window, [[self.q["id"], True]])
        self.assertEqual(self.store.reviews()[0]["stage"], 1)
        self.assertEqual(self.store.state("variation"), LearningState())
        with self.assertRaises(ValueError):
            self.store.answer(rid, self.q, "a", 3)
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM transitions").fetchone()[0], 1)

    def test_transaction_rolls_back_on_failed_learning_write(self):
        rid = self.typed()
        self.store.show_question(rid, self.q, ["a", "b", "c"], "fresh")
        self.store.db.execute("CREATE TRIGGER fail_learning BEFORE INSERT ON learning BEGIN SELECT RAISE(ABORT,'test failure'); END;")
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.answer(rid, self.q, "a", 1)
        self.assertEqual(self.store.db.execute("SELECT outcome FROM questions").fetchone()[0], "pending")
        self.assertEqual(self.store.db.execute("SELECT status FROM rounds").fetchone()[0], "quiz")
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM reviews").fetchone()[0], 0)

    def test_old_benchmark_history_is_preserved_but_excluded_from_progress(self):
        self.typed()
        rid = self.typed()
        # Simulate a row from the prior release, without retaining a benchmark mode.
        with self.store.db:
            self.store.db.execute("UPDATE rounds SET kind='benchmark',status='complete' WHERE id=?", (rid,))
        self.assertEqual(self.store.rounds()[0]["repeated"], 1)
        self.assertEqual(self.store.summary()["count"], 1)
        self.assertEqual(sum(day[3] for day in self.store.daily()), 1)
        self.assertEqual(len(self.store.rounds()), 2)
        paths = self.store.export(Path(self.tmp.name) / "export")
        self.assertIn("benchmark", paths[0].read_text())

    def transition(self, topic, level, created):
        p = next(p for p in self.content.passages.values() if p["topic"] == topic)
        rid = self.typed(p)
        with self.store.db:
            self.store.db.execute(
                "INSERT INTO transitions(topic,previous_level,new_level,round_id,reason,algorithm_version,created) "
                "VALUES(?,1,?,?, 'test',1,?)", (topic, level, rid, created))

    def test_understanding_trend_tracks_levels_and_keeps_topics_separate(self):
        now = self.clock()
        self.transition("foundations", 1, now - 3 * DAY)
        self.transition("foundations", 2, now - 2 * DAY)
        self.transition("variation", 4, now - 2 * DAY)
        self.transition("foundations", 3, now - DAY)
        self.transition("foundations", 2, now - DAY + 1)
        levels = [v for _, v in self.store.understanding_daily("foundations")]
        self.assertEqual(len(levels), 30)
        self.assertTrue(all(v is None for v in levels[:-4]))
        self.assertEqual(levels[-4:], [1, 2, 2, 2])
        self.assertEqual(self.store.understanding_daily("variation")[-1][1], 4)
        # Historical chart is independent of today's mutable learning cache.
        self.assertEqual(self.store.state("foundations").level, 1)

    def test_understanding_seeds_from_before_window_and_ignores_future(self):
        self.transition("foundations", 2, self.clock() - 40 * DAY)
        self.transition("foundations", 4, self.clock() + DAY)
        self.assertEqual([v for _, v in self.store.understanding_daily("foundations")], [2] * 30)
        self.assertTrue(all(v is None for _, v in self.store.understanding_daily("variation")))

    def test_typing_without_quiz_does_not_create_understanding_points(self):
        self.typed()
        self.assertIsNotNone(self.store.daily()[-1][1])
        self.assertTrue(all(v is None for _, v in self.store.understanding_daily("foundations")))

    def test_longer_ranges_include_old_rounds_and_align_both_timelines(self):
        self.clock.advance(-500 * DAY)
        self.typed()
        self.transition("foundations", 2, self.clock())
        self.clock.advance(500 * DAY)
        self.typed()
        for days in (30, 90, 365):
            self.assertEqual(len(self.store.daily(topic="foundations", days=days)), days)
            self.assertEqual(len(self.store.understanding_daily("foundations", days=days)), days)
        daily = self.store.daily(topic="foundations", days=None)
        understanding = self.store.understanding_daily("foundations", days=None)
        self.assertEqual(len(daily), 501)
        self.assertEqual([r[0] for r in daily], [r[0] for r in understanding])
        self.assertIsNotNone(daily[0][1])
        self.assertIsNone(daily[1][1])
        self.assertIsNotNone(daily[-1][1])
        self.assertTrue(all(level == 2 for _, level in understanding))
        self.assertEqual(self.store.history_days("variation", None), 30)

    def test_all_time_uses_topic_history_and_has_empty_fallback(self):
        self.assertEqual(len(self.store.daily(days=None)), 30)
        self.clock.advance(-100 * DAY)
        p = next(p for p in self.content.passages.values() if p["topic"] == "variation")
        self.typed(p)
        self.clock.advance(100 * DAY)
        self.typed()
        self.assertEqual(self.store.history_days("variation", None), 101)
        self.assertEqual(self.store.history_days("foundations", None), 1)
        self.assertEqual(self.store.history_days(None, None), 101)
        for days in (0, -1, 1.5):
            with self.assertRaises(ValueError):
                self.store.daily(days=days)

    def test_trends_need_two_complete_windows(self):
        for _ in range(19):
            self.typed()
            self.clock.advance(1)
        self.assertIsNone(self.store.summary()["change"])
        self.typed(duration=30)
        self.assertEqual(self.store.summary()["change"], 0)
        daily = self.store.daily()
        self.assertEqual(len(daily), 30)
        self.assertEqual(sum(x[3] for x in daily), 20)
        self.assertTrue(any(x[1] is None for x in daily))

    def test_incompatible_scoring_is_excluded(self):
        rid = self.typed()
        m = self.store.rounds()[0]["metrics"]
        m["scoring_version"] = 99
        with self.store.db:
            self.store.db.execute("UPDATE rounds SET metrics=? WHERE id=?", (json.dumps(m), rid))
        self.assertEqual(self.store.summary()["count"], 0)

    def test_local_date_buckets_across_midnight_and_dst(self):
        old = os.environ.get("TZ")
        try:
            os.environ["TZ"] = "America/Denver"
            time.tzset()
            # Both instants straddle local midnight on the spring DST change day.
            self.clock.now = datetime(2026, 3, 8, 6, 59, tzinfo=timezone.utc).timestamp()
            self.typed()
            self.clock.advance(120)
            self.typed()
            nonempty = [row for row in self.store.daily() if row[3]]
            self.assertEqual([(row[0], row[3]) for row in nonempty], [("2026-03-07", 1), ("2026-03-08", 1)])
        finally:
            if old is None:
                os.environ.pop("TZ", None)
            else:
                os.environ["TZ"] = old
            time.tzset()

    def test_exports_join_and_do_not_overwrite(self):
        rid = self.typed()
        self.store.show_question(rid, self.q, ["c", "a", "b"], "fresh")
        self.store.answer(rid, self.q, None, 5)
        directory = Path(self.tmp.name) / "csv"
        paths = self.store.export(directory)
        with paths[0].open() as stream:
            row = next(csv.DictReader(stream))
        self.assertEqual(row["id"], rid)
        self.assertIn("correct_attempts", row)
        with paths[1].open() as stream:
            qrow = next(csv.DictReader(stream))
        self.assertEqual(qrow["round_id"], rid)
        self.assertEqual(json.loads(qrow["option_order"]), ["c", "a", "b"])
        self.assertEqual(qrow["outcome"], "skipped")
        before = paths[0].read_bytes()
        with self.assertRaises(FileExistsError):
            self.store.export(directory)
        self.assertEqual(paths[0].read_bytes(), before)

    def test_exclusive_data_directory(self):
        with self.assertRaises(RuntimeError):
            Storage(self.tmp.name)

    def test_prerequisites_and_alternate_question(self):
        first = recommend(self.content, self.store, concept="molecules", rng=random.Random(1))
        self.assertEqual(first.evidence_kind, "fresh")
        self.assertEqual(first.question["concept"], "molecules")
        self.assertIn(first.passage["id"], first.question["passages"])
        rid = self.typed()
        self.store.show_question(rid, first.question, ["a", "b", "c"], "fresh")
        self.store.answer(rid, first.question, "b", 1)
        second = recommend(self.content, self.store, concept="molecules", rng=random.Random(1))
        self.assertNotEqual(first.question["id"], second.question["id"])
        self.assertTrue(second.review)

    def test_new_players_start_on_a_random_fresh_round(self):
        picks = set()
        for seed in range(1, 21):
            rec = recommend(self.content, self.store, rng=random.Random(seed))
            self.assertEqual(rec.question["topic"], "foundations")
            self.assertEqual(rec.question["level"], 1)
            self.assertEqual(rec.evidence_kind, "fresh")
            picks.add(rec.passage["id"])
        self.assertGreater(len(picks), 1)

    def test_review_round_cap(self):
        first = recommend(self.content, self.store, rng=random.Random(1))
        concept = first.question["concept"]
        rid = self.typed()
        self.store.show_question(rid, first.question, ["a", "b", "c"], "fresh")
        self.store.answer(rid, first.question, "b", 1)
        review = recommend(self.content, self.store, review_streak=1)
        self.assertEqual(review.question["concept"], concept)
        new_work = recommend(self.content, self.store, review_streak=2)
        self.assertNotEqual(new_work.question["concept"], concept)

    def test_exhausted_bank_and_delayed_reassessment(self):
        for q in self.content.questions.values():
            if q["topic"] == "foundations" and q["level"] == 1:
                rid = self.typed(self.content.passages[q["passages"][0]])
                self.store.show_question(rid, q, ["a", "b", "c"], "fresh")
                self.store.answer(rid, q, None, 1)
        self.assertEqual(recommend(self.content, self.store, topic="foundations").evidence_kind, "review")
        self.clock.advance(DAY)
        self.assertEqual(recommend(self.content, self.store, topic="foundations").evidence_kind, "reassessment")


class ContentTests(unittest.TestCase):
    def test_bundled_curriculum(self):
        c = Content()
        self.assertEqual((len(c.topics), len(c.passages), len(c.questions)), (2, 10, 80))

    def test_duplicate_and_missing_option_rejected(self):
        c = Content()
        original = copy.deepcopy(c.data)
        c.data["questions"][1]["id"] = c.data["questions"][0]["id"]
        with self.assertRaises(ContentError):
            c.validate()
        c.data = original
        c.data["questions"][0]["correct"] = "missing"
        with self.assertRaises(ContentError):
            c.validate()

    def test_unreachable_prerequisites_rejected(self):
        c = Content()
        for p in c.data["passages"]:
            p["prerequisites"] = ["molecules"]
        with self.assertRaises(ContentError):
            c.validate()

    def test_word_wrapping_preserves_every_target_character(self):
        for passage in Content().passages.values():
            state = TypingState(passage["text"])
            start = 0
            for end in state.boundaries:
                sentence = state.target[start:end]
                lines = textwrap.wrap(sentence, 70, replace_whitespace=False,
                                      drop_whitespace=False, break_on_hyphens=False)
                self.assertEqual("".join(lines), sentence)
                self.assertLessEqual(len(lines), 6)
                start = end


if __name__ == "__main__":
    unittest.main()
