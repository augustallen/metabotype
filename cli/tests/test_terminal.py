"""Real PTY tests: no curses mocks and no third-party dependencies."""
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import signal
import sqlite3
import struct
import subprocess
import sys
import tempfile
import termios
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]


class Terminal:
    def __init__(self, data_dir):
        self.master, self.slave = pty.openpty()
        self.resize(24, 80, signal_process=False)
        self.before = termios.tcgetattr(self.slave)
        self.process = subprocess.Popen(
            [sys.executable, str(ROOT / 'metabotype.py'), '--data-dir', str(data_dir), '--no-color'],
            stdin=self.slave, stdout=self.slave, stderr=self.slave,
            env={**os.environ, 'TERM': 'xterm-256color'}, start_new_session=True)
        self.output = b''
        self.read_until(b'[P] Play')

    def resize(self, rows, columns, signal_process=True):
        fcntl.ioctl(self.slave, termios.TIOCSWINSZ, struct.pack('HHHH', rows, columns, 0, 0))
        if signal_process:
            self.process.send_signal(signal.SIGWINCH)

    def send(self, text):
        os.write(self.master, text.encode() if isinstance(text, str) else text)

    def pump(self, timeout=0.05):
        if select.select([self.master], [], [], timeout)[0]:
            try:
                self.output += os.read(self.master, 65536)
            except OSError as exc:
                if exc.errno != errno.EIO:
                    raise

    def read_until(self, marker, timeout=5, start=0):
        deadline = time.monotonic() + timeout
        while marker not in self.output[start:]:
            if time.monotonic() > deadline:
                raise AssertionError(f'Missing {marker!r}; terminal tail: {self.output[-4000:]!r}')
            self.pump()
        return self.output

    def close(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.wait_exit(2)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
        os.close(self.master)
        os.close(self.slave)

    def wait_exit(self, timeout=3):
        # A real terminal consumes output while curses drains it during teardown.
        # Waiting without reading can deadlock the child on macOS PTYs.
        deadline = time.monotonic() + timeout
        while self.process.poll() is None:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise subprocess.TimeoutExpired(self.process.args, timeout)
            self.pump(min(0.05, remaining))
        return self.process.returncode


class TerminalTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.t = Terminal(self.tmp.name)
        self.content = json.loads((ROOT / 'src/metabotype/data/curriculum.json').read_text())

    def tearDown(self):
        self.t.close()
        self.tmp.cleanup()

    def db(self):
        db = sqlite3.connect(Path(self.tmp.name) / 'history.sqlite3')
        db.row_factory = sqlite3.Row
        self.addCleanup(db.close)
        return db

    def assert_terminal_restored(self):
        after = termios.tcgetattr(self.t.slave)
        before = list(self.t.before)
        if sys.platform == 'darwin':
            # XNU sets PENDIN when restoring ICANON. It is transient input
            # queue state, cleared by the next read, not a changed setting.
            # https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/tty.c
            after[3] &= ~termios.PENDIN
            before[3] &= ~termios.PENDIN
        self.assertEqual(after, before)

    def begin(self):
        self.t.send('p')
        self.t.read_until(b'Sentence 1 of')
        row = self.db().execute('SELECT * FROM rounds ORDER BY started DESC LIMIT 1').fetchone()
        p = next(x for x in self.content['passages'] if x['id'] == row['passage_id'])
        p = dict(p, typing_text=p['text'])
        return row['id'], p

    def test_complete_round_history_and_clean_terminal(self):
        rid, p = self.begin()
        self.t.send(p['typing_text'][0])
        time.sleep(0.05)
        self.t.send(p['typing_text'][1:])
        self.t.read_until(b'QUESTION')
        q = self.db().execute('SELECT * FROM questions WHERE round_id=?', (rid,)).fetchone()
        display = json.loads(q['option_order'])
        self.t.send(str(display.index('a') + 1) + '\n')
        self.t.read_until(b'CORRECT!')
        self.t.send('h')
        # Wait for the home redraw, then open the notebook.
        start = len(self.t.output)
        self.t.read_until(b'[P] Play', start=start)
        self.t.send('h')
        self.t.read_until(b'FIELD NOTEBOOK')
        self.t.read_until(b'TYPING / daily medians')
        self.t.read_until(b'UNDERSTANDING')
        row = self.db().execute('SELECT * FROM rounds WHERE id=?', (rid,)).fetchone()
        self.assertEqual(row['status'], 'complete')
        m = json.loads(row['metrics'])
        self.assertEqual(m['accuracy'], 100)
        self.assertEqual(m['accepted_count'], len(p['typing_text']))
        self.assertEqual(self.db().execute('SELECT outcome FROM questions WHERE round_id=?', (rid,)).fetchone()[0], 'correct')
        self.t.send('\x1b')
        start = len(self.t.output)
        self.t.read_until(b'[P] Play', start=start)
        self.t.send('q')
        self.assertEqual(self.t.wait_exit(), 0)
        self.assert_terminal_restored()

    def test_paste_cannot_score_or_inject_menu_commands(self):
        rid, p = self.begin()
        self.t.send('\x1b[200~' + p['text'] + '\nq\n' + '\x1b[201~')
        self.t.read_until(b'PASTE DETECTED')
        # Drain the remainder of the paste before sending actual navigation.
        deadline = time.monotonic() + 0.5
        while time.monotonic() < deadline:
            self.t.pump(0.01)
        self.assertIsNone(self.t.process.poll())
        row = self.db().execute('SELECT * FROM rounds WHERE id=?', (rid,)).fetchone()
        self.assertEqual(row['status'], 'aborted')
        self.assertTrue(json.loads(row['metrics'])['invalid'])
        self.assertIsNone(json.loads(row['metrics'])['wpm'])

    def test_notebook_left_arrow_opens_all_time_in_real_terminal(self):
        self.t.send('h')
        self.t.read_until(b'FIELD NOTEBOOK')
        self.t.read_until(b'30 days')
        start = len(self.t.output)
        # xterm application cursor mode, enabled by curses keypad handling.
        self.t.send('\x1bOD')
        self.t.read_until(b'All time', start=start)
        self.assertIsNone(self.t.process.poll())

    def test_escape_pauses_and_resumes_promptly(self):
        self.begin()
        for marker in (b'PAUSED', b'Sentence 1 of'):
            start = len(self.t.output)
            pressed = time.monotonic()
            self.t.send('\x1b')
            self.t.read_until(marker, start=start)
            self.assertLess(time.monotonic() - pressed, 0.3)

    def test_resize_and_pause_keep_input_out_of_scoring(self):
        rid, p = self.begin()
        self.t.send(p['typing_text'][0])
        time.sleep(0.05)
        self.t.resize(15, 50)
        self.t.read_until(b'Lab paused.')
        self.t.send('XYZ')
        time.sleep(0.1)
        self.t.resize(24, 80)
        start = len(self.t.output)
        self.t.read_until(b'Sentence 1 of', start=start)
        self.t.send('\x1b')
        self.t.read_until(b'PAUSED')
        time.sleep(0.1)
        self.t.send('\n')
        start = len(self.t.output)
        self.t.read_until(b'Sentence 1 of', start=start)
        self.t.send(p['typing_text'][1:])
        self.t.read_until(b'QUESTION')
        row = self.db().execute('SELECT metrics FROM rounds WHERE id=?', (rid,)).fetchone()
        metrics = json.loads(row[0])
        self.assertEqual(metrics['incorrect_attempts'], 0)
        self.assertGreater(metrics['pause_duration'], 0.15)
        self.t.send('\x1b')
        self.t.read_until(b'[P] Play')
        self.assertEqual(self.db().execute('SELECT typing_status FROM rounds WHERE id=?', (rid,)).fetchone()[0], 'complete')

    def test_killed_process_recovers_completed_typing(self):
        rid, p = self.begin()
        self.t.send(p['typing_text'])
        self.t.read_until(b'QUESTION')
        self.t.process.kill()
        self.t.process.wait()
        self.t.close()
        self.t = Terminal(self.tmp.name)
        self.t.read_until(b'Recovered 1 unfinished round')
        row = self.db().execute('SELECT status,typing_status FROM rounds WHERE id=?', (rid,)).fetchone()
        self.assertEqual(tuple(row), ('interrupted', 'complete'))

    def test_ctrl_c_saves_partial_result_and_restores_terminal(self):
        rid, p = self.begin()
        self.t.send(p['text'][:8])
        time.sleep(0.1)
        self.t.process.send_signal(signal.SIGINT)
        self.assertEqual(self.t.wait_exit(), 130)
        self.assert_terminal_restored()
        row = self.db().execute('SELECT status,metrics FROM rounds WHERE id=?', (rid,)).fetchone()
        self.assertEqual(row['status'], 'aborted')
        self.assertEqual(json.loads(row['metrics'])['accepted_count'], 8)

    def test_separator_space_advances_and_saves_checkpoint(self):
        rid, p = self.begin()
        first = re.split(r'(?<=[.!?]) +', p['text'])[0]
        self.t.send(first + '\x1b')
        self.t.read_until(b'PAUSED')
        db = self.db()
        self.assertIsNone(db.execute('SELECT metrics FROM rounds WHERE id=?', (rid,)).fetchone()[0])
        self.t.send('\n ')
        # Curses may redraw only the digit "2"; wait on the durable checkpoint.
        deadline = time.monotonic() + 3
        row = db.execute('SELECT metrics FROM rounds WHERE id=?', (rid,)).fetchone()
        while row[0] is None and time.monotonic() < deadline:
            self.t.pump()
            row = db.execute('SELECT metrics FROM rounds WHERE id=?', (rid,)).fetchone()
        self.assertIsNotNone(row[0])
        self.assertEqual(json.loads(row[0])['accepted_count'], len(first) + 1)
        self.t.send(p['typing_text'][len(first) + 1:])
        self.t.read_until(b'QUESTION')

    def test_backspace_and_option_backspace_repair_real_input(self):
        rid, p = self.begin()
        # Mistype the opening character, erase it, then mistype the next word.
        prefix = p['typing_text'].split(' ', 1)[0] + ' '
        self.t.send('x\x7f' + prefix + 'wrong')
        self.t.read_until(b'Backspace to fix')
        # Meta/Option+Backspace followed immediately by text must not eat it.
        self.t.send('\x1b\x7f' + p['typing_text'][len(prefix):])
        self.t.read_until(b'QUESTION')
        m = json.loads(self.db().execute('SELECT metrics FROM rounds WHERE id=?', (rid,)).fetchone()[0])
        self.assertEqual(m['backspaces'], 1)
        self.assertEqual(m['word_deletions'], 1)
        self.assertEqual(m['deleted_characters'], 6)
        self.assertEqual(m['accepted_count'], len(p['typing_text']))
        self.assertLess(m['accuracy'], 100)

    def test_double_space_shortcut_completes_round_without_mistakes(self):
        rid, p = self.begin()
        shortcut_text = re.sub(r'\.( +|$)', '  ', p['text'])
        self.t.send(shortcut_text)
        self.t.read_until(b'QUESTION')
        m = json.loads(self.db().execute('SELECT metrics FROM rounds WHERE id=?', (rid,)).fetchone()[0])
        self.assertEqual(m['accepted_count'], len(p['text']))
        self.assertEqual(m['accuracy'], 100)
        self.assertEqual(m['incorrect_attempts'], 0)
        self.assertGreater(m['period_shortcuts'], 1)


if __name__ == '__main__':
    unittest.main()
