# metabotype

![Metabotype — Small molecules. Steady fingers. A retro terminal surrounded by molecular motifs.](assets/readme-banner.png)

**Small molecules. Steady fingers.** Type a short passage, answer a metabolomics question, and watch your progress in the field notebook.

## Play

Linux, Python **3.11+** with `curses`, and an **80 x 24** terminal. No runtime dependencies or network access required.

```bash
python metabotype.py
```

Or install in a virtual environment:

```bash
python -m venv .venv
.venv/bin/python -m pip install .
.venv/bin/metabotype
```

Installation uses setuptools. Direct checkout play does not need pip. For a portable offline copy, run `python scripts/build_zipapp.py`, then `python dist/metabotype.pyz` from any directory.

## Controls

| Screen | Keys |
| --- | --- |
| Home | Enter plays; arrows select Play, Topics, or Field notebook; Q quits |
| Typing | Type normally; Backspace erases a character; Option/Alt+Backspace erases a word; Esc pauses |
| Question | Number selects; Enter confirms; S skips; Esc returns home |
| Results | Enter continues; Esc returns home; ? opens details and sources |
| Field notebook | Left/Right changes range; Tab changes topic; Enter opens recent rounds; Esc returns home |
| Long pages | Up/Down or J/K scroll; Enter or Esc returns |

P, T, and H are home shortcuts for Play, Topics, and Field notebook. Spaces display as normal spaces. The cursor is reversed and underlined. Typed mistakes stay in the text until deleted: use Backspace to erase a character, or Option/Alt+Backspace to erase the current word. Correct text in the current sentence is editable too. Word deletion removes trailing spaces and the preceding space-delimited word. Ctrl+W is an alternative word-delete key; F1 opens help.

Type the space after sentence-ending punctuation to advance to the next sentence. That separator appears as a normal highlighted space and counts toward typing statistics. No Enter is required. The final sentence finishes on its last character, without an extra trailing space. Completed sentences stay locked.

You can also press **Space twice** when the sentence's final period is next. This enters `. ` and advances, or just the final period at the end of the passage. It only works at an expected period with no uncorrected mistakes; question marks, exclamation marks, and ordinary spaces still need their normal keys. A single space waits for the second; another typing or deletion key treats the first space as literal input. The shortcut gives no extra WPM credit.

Option/Alt+Backspace is decoded as Escape followed by Backspace/DEL. If your terminal intercepts it, use Ctrl+W or configure it to send that sequence; see your terminal's key settings ([iTerm2 example](https://iterm2.com/documentation-preferences-profiles-keys.html)).

All progress saves automatically. There is no pre-round confirmation screen. Results show typing performance and a short answer explanation; detailed sources are one key away. Use `--no-color` or `NO_COLOR` for monochrome. Windows smaller than 80 x 24 pause typing.

## Progress

The notebook opens directly to **two graphs for the selected topic**. Left/Right cycles through **30 days, 90 days, 1 year (365 days), and all time**. Press Left once from the default 30-day view to reach all time. Both graphs share the selected timeline, and the range stays selected while the app is open.

- **Typing:** daily median WPM from completed, scored game passages. Lines connect observations across missed days, keeping their calendar spacing; unplayed days never become zero scores or estimated scores. The line stops at the latest observation. Sparse observations have dot markers; dense histories emphasize the line and mark its endpoint. A single score is a dot, not a trend.
- **Understanding:** the topic's end-of-day difficulty level, reconstructed from recorded level history. Levels are 1 Recognize, 2 Explain, 3 Apply, and 4 Evaluate. Days without answers keep the last known level; days before the first recorded assessment are blank.

All time starts with the selected topic's earliest recorded game or learning event and ends today. Longer WPM histories are grouped into equal calendar intervals to fit the terminal. Each interval's median of daily medians is placed on its last played day, preserving calendar spacing and leaving days after the latest score blank. Understanding keeps every recorded level change, including brief rises or drops. Connections span empty intervals without adding measurements. Dates include years when needed. An empty all-time notebook uses a blank 30-day timeline until the first round.

The notebook uses teal Unicode WPM lines, amber understanding steps, and two framed panels that grow with the terminal. The WPM scale fits the observed values with padding; both graphs share a date axis. Headlines show the latest scored day's WPM and date, and the latest known understanding level. The selected time range is highlighted. Terminals with an ASCII encoding use simpler drawing characters.

Press Tab to compare topics individually. Completed typing contributes even if its quiz is unanswered. Typing speed never changes understanding levels. The weekly benchmark has been removed; old records remain in the database and CSV exports but are excluded from game-progress charts.

The game includes two topics, ten passages of 60–90 words, and eighty questions. Five distinct eligible questions, at least four correct and the most recent two correct, promote one level. Two eligible wrong answers in a row trigger reinforcement and can lower the level. Skips do not change the evidence window or error streak.

Immediate repeats are practice only. Questions last shown at least 24 hours ago can count as labeled reassessments, still requiring distinct IDs within the promotion window. Correct eligible answers schedule a one-day check, then a check seven days after successful review. Misses and skips return the concept to immediate review. Levels guide practice; they are not certification of mastery.

WPM is accepted characters divided by five, divided by active minutes. Spaces, including sentence separators, and punctuation count. Only the currently correct prefix and completed sentences contribute, so deleting and retyping cannot add speed credit. Timing starts with the first printable attempt, including a mistake. Explicit pauses are excluded; ordinary hesitation and correction time count. Accuracy records each target position's first attempt and never improves merely because you deleted an error. Extra characters past the sentence end count as mistakes. A zero-duration attempt has no WPM. Passage difficulty and familiarity can affect typing speed.

These editing rules use scoring version 3 (required sentence spaces with editable text). Earlier scores remain visible in recent rounds (labeled as earlier typing rules) and CSV exports. WPM graphs and summary comparisons use the current scoring rules; understanding history continues unchanged.

## Data and commands

History lives in `$XDG_DATA_HOME/metabotype/history.sqlite3`, or `~/.local/share/metabotype/history.sqlite3` if the XDG directory is unset or relative.

```bash
python metabotype.py --data-dir /tmp/my-field-lab
python metabotype.py --data-dir /tmp/my-field-lab stats
python metabotype.py --data-dir /tmp/my-field-lab export /tmp/my-field-export
python metabotype.py validate-content
```

Global options precede the command. CSV export is available through the command line and never overwrites files. `rounds.csv` joins `question_attempts.csv` through `id` / `round_id`. Timestamps are UTC Unix seconds. Exports retain raw metrics, versions, answer option order, and evidence labels. The `stats` command reports median WPM and a change only after two full ten-round windows. Incompatible scoring versions are excluded from comparisons.

Completed typing and answers save separately. Intentional aborts save current partial statistics; crashes preserve partial statistics through the last sentence checkpoint. On restart, unfinished rounds are marked interrupted and a fresh timer starts for the next round. Only one process can use a notebook at once. Back up its directory with the game closed.

Bracketed paste is discarded and makes the typing attempt unscored. Unmarked paste cannot reliably be distinguished from typing. No keystroke traces are stored.

## Development

```bash
python -m unittest discover -s tests -v
python metabotype.py validate-content
python scripts/build_zipapp.py
```

Content is bundled in `src/metabotype/data/curriculum.json`, with stable IDs, versions, prerequisites, answer explanations, and source links. Tests cover scoring, learning, persistence, historical graphs, ordinary-space rendering, and real-terminal play and recovery.

See [CONTENT_REVIEW.md](CONTENT_REVIEW.md) for source attribution and review limitations, and [PLAN.md](PLAN.md) for the curriculum roadmap. Scientific review and difficulty calibration with learners remain useful before classroom use.

## License

[MIT](LICENSE) — Copyright (c) 2026 August Allen.
