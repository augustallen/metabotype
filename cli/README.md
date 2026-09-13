# Metabotype for the terminal

The original keyboard-only version. Requires Python 3.11+ on Linux or macOS. No dependencies to install.

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

## Data and commands

History is saved to `~/.local/share/metabotype/history.sqlite3` (or under `$XDG_DATA_HOME`). It is separate from the web version's browser history; both export the same CSV columns.

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
python tools/gen_fixtures.py ../test/fixtures        # parity fixtures for the web port
```

The curriculum is a symlink to `../content/curriculum.json`, shared with the web version.
