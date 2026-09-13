"""Render checks for ordinary spaces and compact notebook charts."""
import curses
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from metabotype.content import Content
from metabotype.learning import LearningState
from metabotype.storage import Storage
from metabotype.ui.app import App
from metabotype.ui.charts import chart_rows, compact_series


class Screen:
    def __init__(self, height=24, width=80):
        self.height, self.width = height, width
        self.frames = []
        self.erase()

    def getmaxyx(self):
        return self.height, self.width

    def erase(self):
        self.cells = [[(' ', 0) for _ in range(self.width)] for _ in range(self.height)]

    def addnstr(self, y, x, text, count, attr):
        for column, char in enumerate(text[:count], x):
            self.cells[y][column] = (char, attr)

    def refresh(self):
        self.frames.append([row[:] for row in self.cells])

    def timeout(self, _):
        pass

    def keypad(self, _):
        pass

    def text(self, frame=-1):
        return '\n'.join(''.join(c for c, _ in row) for row in self.frames[frame])


class ChartTests(unittest.TestCase):
    def test_missed_days_connect_without_extrapolation_or_mutating_scores(self):
        values = [None, 0, None, None, 10, None]
        rows = chart_rows(values, 31, 5, 10)
        self.assertEqual(values, [None, 0, None, None, 10, None])
        self.assertEqual(sum(row.count('●') for row in rows), 2)
        self.assertTrue(all(not row[:6].strip() and not row[25:].strip() for row in rows))
        self.assertTrue(all(any(row[x] != ' ' for row in rows) for x in range(6, 25)))

    def test_level_changes_are_steps_not_slopes(self):
        rows = chart_rows([1, 1, 4, 4], 10, 4, 4, 1, step=True)
        self.assertEqual(rows[-1][:6], '╶─────')
        self.assertEqual(rows[1][6], '│')
        self.assertEqual(rows[2][6], '│')
        self.assertEqual(rows[0][6:], '┌──●')
        self.assertEqual(rows[1][:6], ' ' * 6)

    def test_single_score_has_no_invented_trend(self):
        rows = chart_rows([None, 42, None], 20, 6, 50)
        self.assertEqual(''.join(rows).strip(), '●')
        rows = chart_rows([42], 21, 6, 50)
        self.assertEqual(''.join(rows).strip(), '●')
        self.assertTrue(any(row[10] == '●' for row in rows))

    def test_ascii_fallback_connects_observations(self):
        for step in (False, True):
            rows = chart_rows([1, None, 4], 10, 4, 4, 1, step, unicode=False)
            self.assertTrue(''.join(rows).isascii())
            self.assertTrue(all(any(row[x] != ' ' for row in rows) for x in range(10)))

    def test_missing_history_is_empty(self):
        self.assertEqual(chart_rows([None] * 30, 10, 4, 4, 1), [' ' * 10] * 4)

    def test_long_histories_keep_old_data_and_empty_intervals(self):
        values = [10, 20, None, None, 30, 90, 0, None]
        self.assertEqual(compact_series(values, 4), [None, 15, None, None, None, 60, 0, None])
        self.assertEqual(compact_series([1, None, 3], 10), [1, None, 3])

    def test_grouping_keeps_sparse_scores_on_the_days_they_were_played(self):
        values = [None, 20, None, None, None, None, 40, None]
        grouped = compact_series(values, 2)
        self.assertEqual(grouped, values)
        self.assertEqual(chart_rows(grouped, 17, 5, 50), chart_rows(values, 17, 5, 50))

    def test_understanding_keeps_brief_level_changes_in_long_histories(self):
        levels = [1, 4, 1, 1, 1, 1]
        self.assertEqual(compact_series(levels, 2, step=True), levels)

    def test_compaction_rejects_zero_width(self):
        with self.assertRaises(ValueError):
            compact_series([42], 0)


class RenderTests(unittest.TestCase):
    def setUp(self):
        self.screen = Screen()
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Storage(self.tmp.name)
        self.content = Content()
        with patch('curses.curs_set'):
            self.app = App(self.screen, self.content, self.store, no_color=True)
        self.app.keyboard = Mock()

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def test_literal_space_is_highlighted_and_scored(self):
        self.app.storage = Mock()
        self.app.keyboard.get.side_effect = ['A', ' ', 'b', '.']
        metrics = self.app.type_passage('test', {'title': 'Test', 'text': 'A b.'})
        self.assertEqual(metrics['accepted_count'], 4)
        self.assertEqual(metrics['accuracy'], 100)
        self.assertIn('A b.', self.screen.text(0))
        self.assertNotIn('·', self.screen.text(0))
        char, style = self.screen.frames[1][11][6]
        self.assertEqual(char, ' ')
        self.assertTrue(style & curses.A_REVERSE)

    def test_notebook_shows_both_graphs_at_minimum_size_and_switches_topics(self):
        self.app.keyboard.get.side_effect = ['\t', 'ESC']
        self.app.history()
        text = self.screen.text(0)
        self.assertIn('TYPING / daily medians', text)
        self.assertIn('UNDERSTANDING', text)
        self.assertIn('[Tab] Topic', text)
        self.assertIn('The molecular world', text)
        self.assertIn('The context detectives', self.screen.text(1))
        self.assertNotIn('benchmark', text.lower())

    def test_results_save_silently_and_offer_only_main_actions(self):
        q = self.content.questions['q-molecules-1']
        self.app.keyboard.get.return_value = 'ESC'
        self.app.results({'wpm': 42, 'accuracy': 98}, self.content.passages['p-molecules'],
                         q, ('correct', 'Understanding evidence saved.', LearningState()))
        text = self.screen.text()
        self.assertIn('42.0 WPM', text)
        self.assertIn('Answer:', text)
        self.assertNotIn('saved', text)
        self.assertNotIn('Retry', text)
        self.assertNotIn('combo', text)

    def test_arrows_cycle_ranges_for_both_graphs_and_keep_topic_selection(self):
        with patch.object(self.store, 'daily', wraps=self.store.daily) as typing, \
             patch.object(self.store, 'understanding_daily', wraps=self.store.understanding_daily) as learning:
            self.app.keyboard.get.side_effect = [curses.KEY_RIGHT, curses.KEY_RIGHT,
                                                 curses.KEY_RIGHT, '\t', curses.KEY_LEFT, 'ESC']
            self.app.history()
            self.assertEqual([call.kwargs['days'] for call in typing.call_args_list],
                             [30, 90, 365, None, None, 365])
            self.assertEqual([call.kwargs['days'] for call in learning.call_args_list],
                             [30, 90, 365, None, None, 365])
        for frame, label in enumerate(['30 days', '90 days', '1 year', 'All time', 'All time', '1 year']):
            self.assertIn(label, self.screen.text(frame))
            selected = ''.join(c for row in self.screen.frames[frame] for c, attr in row if attr & curses.A_REVERSE)
            self.assertEqual(selected.strip(), label)
            self.assertIn('UNDERSTANDING', self.screen.text(frame))
        self.assertIn('The context detectives', self.screen.text(4))
        self.assertIn('[Left/Right] Range', self.screen.text(0))

    def test_left_arrow_reaches_all_time_and_range_survives_reopening(self):
        self.app.keyboard.get.side_effect = [curses.KEY_LEFT, 'ESC']
        self.app.history()
        self.assertIn('All time', self.screen.text())
        self.app.keyboard.get.side_effect = ['ESC']
        self.app.history()
        self.assertIn('All time', self.screen.text())

    def test_date_axis_includes_years_for_long_histories(self):
        self.app.storage = Mock()
        self.app.storage.db.execute.return_value.fetchone.return_value = None
        self.app.storage.clock.return_value = 1789257600
        self.app.storage.daily.return_value = [('2024-09-12', 20, 100, 1), ('2026-09-12', 40, 100, 1)]
        self.app.storage.understanding_daily.return_value = [('2024-09-12', 1), ('2026-09-12', 2)]
        self.app.keyboard.get.return_value = 'ESC'
        self.app.history()
        self.assertIn("Sep 12 '24", self.screen.text())
        self.assertIn("Sep 12 '26", self.screen.text())
        self.assertIn('40.0 WPM', self.screen.text())
        self.assertIn('Latest day: 2026-09-12', self.screen.text())
        self.assertIn('Level 2 of 4', self.screen.text())
        self.assertIn('Explain', self.screen.text())

    def test_notebook_grows_with_terminal_and_preserves_controls(self):
        self.app.keyboard.get.return_value = 'ESC'
        self.app.history()
        small = self.screen.text()
        self.screen.height, self.screen.width = 40, 140
        self.app.history()
        large = self.screen.text()
        self.assertGreater(large.count('│'), small.count('│'))
        self.assertGreater(max(len(line.strip()) for line in large.splitlines()),
                           max(len(line.strip()) for line in small.splitlines()))
        self.assertIn('[Esc] Home', large)
        self.assertEqual(large.count('╭'), 2)
        self.assertEqual(large.count('╰'), 2)
        self.assertIn('Play a round to begin', large)
        self.assertIn('Answer a question to begin', large)

    def test_single_day_notebook_uses_one_date_label(self):
        with patch.object(self.store, 'daily', return_value=[('2026-09-12', 42, 100, 1)]), \
             patch.object(self.store, 'understanding_daily', return_value=[('2026-09-12', None)]):
            self.app.keyboard.get.return_value = 'ESC'
            self.app.history()
        self.assertEqual(self.screen.text().count('Sep 12'), 1)
        self.assertEqual(self.screen.text().count('●'), 1)
        self.assertIn('42.0 WPM', self.screen.text())

    def test_notebook_falls_back_for_ascii_terminal(self):
        self.screen.encoding = 'ascii'
        self.app.keyboard.get.return_value = 'ESC'
        self.app.history()
        self.assertTrue(self.screen.text().isascii())
        self.assertIn('UNDERSTANDING', self.screen.text())

    def test_idle_notebook_waits_and_resize_redraws_without_reloading_history(self):
        with patch.object(self.store, 'daily', wraps=self.store.daily) as daily:
            self.app.keyboard.get.side_effect = [None, None, curses.KEY_RESIZE, None, 'ESC']
            self.app.history()
        self.assertEqual(len(self.screen.frames), 2)
        daily.assert_called_once()

    def test_idle_notebook_updates_its_timeline_at_midnight(self):
        from datetime import datetime
        before = datetime(2026, 9, 12, 23, 59, 59).timestamp()
        after = datetime(2026, 9, 13, 0, 0, 1).timestamp()
        self.store.clock = Mock(return_value=before)

        def midnight():
            self.store.clock.return_value = after
            self.app.keyboard.get.return_value = 'ESC'
            self.app.keyboard.get.side_effect = None
            return None

        self.app.keyboard.get.side_effect = midnight
        self.app.history()
        self.assertIn('Sep 12', self.screen.text(0))
        self.assertIn('Sep 13', self.screen.text(1))

    def test_typing_keeps_errors_until_deleted_and_scrolls_long_input(self):
        self.app.storage = Mock()
        self.app.keyboard.get.side_effect = list('x' * 500) + ['WORD_BACKSPACE'] + list('Hi. Bye.')
        metrics = self.app.type_passage('test', {'title': 'Test', 'text': 'Hi. Bye.'})
        self.assertEqual(metrics['accepted_count'], 8)
        self.assertEqual(metrics['word_deletions'], 1)
        text = self.screen.text(499)
        self.assertIn('Backspace to fix', text)
        self.assertIn('[Esc] Pause', text)
        self.assertNotIn('Hi.Bye.', text)

    def test_earlier_scores_remain_readable_without_entering_new_trends(self):
        self.store.start_session()
        p = self.content.passages['p-molecules']
        rid, _ = self.store.begin_round(p, 'legacy fixture')
        self.store.save_typing(rid, {'wpm': 42, 'accuracy': 100, 'scoring_version': 1,
                                    'typing_mode': 'correction-required', 'invalid': False}, p, complete=True)
        self.app.keyboard.get.return_value = 'ESC'
        self.app.recent_rounds('foundations')
        self.assertIn('42.0', self.screen.text())
        self.assertIn('earlier typing rules', self.screen.text())
        self.assertEqual(self.store.summary()['count'], 0)


if __name__ == '__main__':
    unittest.main()
