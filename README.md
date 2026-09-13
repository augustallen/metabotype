# metabotype

![Metabotype — Small molecules. Steady fingers. A retro terminal surrounded by molecular motifs.](assets/readme-banner.png)

**Small molecules. Steady fingers.** Type a short passage, answer a metabolomics question, and watch your progress in the field notebook.

## Play

Requires Python 3.11+ on Linux or macOS. No dependencies to install.

```bash
python metabotype.py
```

Or install it:

```bash
python -m venv .venv
.venv/bin/python -m pip install .
.venv/bin/metabotype
```

For a single portable file, run `python scripts/build_zipapp.py`, then `python dist/metabotype.pyz`.

## Controls

| Screen | Keys |
| --- | --- |
| Home | Enter plays; arrows select Play, Topics, or Field notebook; Q quits |
| Typing | Type normally; Backspace erases a character; Alt+Backspace or Ctrl+W erases a word; Esc pauses |
| Question | Number selects; Enter confirms; S skips; Esc returns home |
| Results | Enter continues; Esc returns home; ? opens details and sources |
| Field notebook | Left/Right changes time range; Tab changes topic; Enter opens recent rounds; Esc returns home |
| Long pages | Up/Down or J/K scroll; Enter or Esc returns |

F1 opens help. Use `--no-color` (or set `NO_COLOR`) for monochrome.

**Typing tips**

- Mistakes stay on screen until you delete them.
- Type the space after a sentence's final punctuation to move to the next sentence. No Enter needed.
- Shortcut: press Space twice when a sentence's final period is next.
- Progress saves automatically.

## How it works

**Typing speed.** WPM is correct characters ÷ 5 ÷ active minutes. Pauses don't count against you, but deleting and retyping can't add speed. Accuracy is based on your first attempt at each character.

**Understanding.** Each topic has four levels: 1 Recognize, 2 Explain, 3 Apply, 4 Evaluate. Answer enough questions correctly to move up; repeated misses bring extra review. Questions come back for review after a day, then a week.

**Field notebook.** Two graphs per topic, daily WPM and understanding level, over 30 days, 90 days, 1 year, or all time.

The game includes two topics, ten passages, and eighty questions.

## Data and commands

History is saved to `~/.local/share/metabotype/history.sqlite3` (or under `$XDG_DATA_HOME`).

```bash
python metabotype.py --data-dir /tmp/my-lab          # use a different data folder
python metabotype.py stats                           # print a typing summary
python metabotype.py export /tmp/my-export           # export history to CSV
python metabotype.py validate-content                # check bundled content
```

## Development

```bash
python -m unittest discover -s tests -v
python metabotype.py validate-content
python scripts/build_zipapp.py
```

Content lives in `src/metabotype/data/curriculum.json`. See [CONTENT_REVIEW.md](CONTENT_REVIEW.md) for sources and review notes, and [PLAN.md](PLAN.md) for the roadmap.

## License

[MIT](LICENSE) — Copyright (c) 2026 August Allen.
