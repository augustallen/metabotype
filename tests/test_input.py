"""Keyboard decoding must distinguish word deletion, pause, and paste."""
import curses
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from metabotype.ui.input import Keyboard


class KeyboardTests(unittest.TestCase):
    def test_option_backspace_does_not_pause_or_swallow_following_typing(self):
        for backspace in ('\x7f', '\b', curses.KEY_BACKSPACE):
            window = Mock()
            window.get_wch.side_effect = ['\x1b', backspace, 'a']
            keyboard = Keyboard(window)
            self.assertEqual(keyboard.get(), 'WORD_BACKSPACE')
            self.assertEqual(keyboard.get(), 'a')
            self.assertEqual(window.timeout.call_args.args, (50,))

    def test_ctrl_w_and_plain_backspace(self):
        window = Mock()
        window.get_wch.side_effect = ['\x17', '\x7f', '\b']
        keyboard = Keyboard(window)
        self.assertEqual([keyboard.get() for _ in range(3)],
                         ['WORD_BACKSPACE', 'BACKSPACE', 'BACKSPACE'])

    def test_escape_alone_still_pauses(self):
        window = Mock()
        window.get_wch.side_effect = ['\x1b', curses.error()]
        self.assertEqual(Keyboard(window).get(), 'ESC')

    def test_escape_keeps_unrelated_following_text(self):
        window = Mock()
        window.get_wch.side_effect = ['\x1b', 'a']
        with patch('curses.unget_wch') as unget:
            self.assertEqual(Keyboard(window).get(), 'ESC')
            unget.assert_called_once_with('a')

    def test_word_delete_bytes_inside_paste_are_not_commands(self):
        window = Mock()
        window.get_wch.side_effect = list('\x1b[200~\x1b\x7f\x17\x1b[201~a')
        keyboard = Keyboard(window)
        self.assertEqual(keyboard.get(), 'PASTE')
        while keyboard.pasting:
            self.assertIsNone(keyboard.get())
        self.assertEqual(keyboard.get(), 'a')


if __name__ == '__main__':
    unittest.main()
