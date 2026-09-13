"""Decode bracketed paste without treating pasted commands as navigation."""
import curses


class Keyboard:
    def __init__(self, window):
        self.window = window
        self.pasting = False
        self.tail = ""

    def get(self):
        try:
            key = self.window.get_wch()
        except curses.error:
            return None
        if self.pasting:
            if isinstance(key, str):
                self.tail = (self.tail + key)[-6:]
                if self.tail == "\x1b[201~":
                    self.pasting = False
                    self.tail = ""
            return None
        if key == "\x1b":
            sequence = ""
            self.window.timeout(25)
            try:
                for _ in range(5):
                    try:
                        item = self.window.get_wch()
                    except curses.error:
                        break
                    if not sequence and item in (curses.KEY_BACKSPACE, "\x7f", "\b"):
                        return "WORD_BACKSPACE"
                    if not isinstance(item, str):
                        curses.ungetch(item)
                        break
                    sequence += item
                    if not "[200~".startswith(sequence) or item == "~":
                        break
            finally:
                self.window.timeout(50)
            if sequence == "[200~":
                self.pasting = True
                return "PASTE"
            if sequence:
                # Preserve ordinary fast input after Escape; don't swallow it.
                for item in reversed(sequence):
                    curses.unget_wch(item)
            return "ESC"
        if key in (curses.KEY_BACKSPACE, "\x7f", "\b"):
            return "BACKSPACE"
        if key == "\x17":
            return "WORD_BACKSPACE"
        if key in (curses.KEY_ENTER, "\n", "\r"):
            return "ENTER"
        if key == curses.KEY_F1:
            return "HELP"
        return key
