# metabotype

![Metabotype — Small molecules. Steady fingers. A retro terminal surrounded by molecular motifs.](assets/readme-banner.png)

**Small molecules. Steady fingers.** Type five sentences, answer a metabolomics question, and watch your progress in the field notebook.

Metabotype comes in two forms that share one curriculum:

- **The website** (this directory): plays in any modern browser, and is built for phones first. Install it to your home screen and it works offline.
- **The terminal game** (`cli/`): the original Python 3.11+ curses version. See [cli/README.md](cli/README.md).

## Play in the terminal

Requires Python 3.11+ on Linux or macOS. Install it straight from GitHub, no clone needed:

```bash
pipx install "git+https://github.com/augustallen/metabotype#subdirectory=cli"
metabotype
```

Or from a clone: `cd cli && python metabotype.py`.

## Play on the web

Open the hosted site, or run it locally:

```bash
npm install
npm run dev          # http://localhost:5173
```

`npm run build` writes a static `dist/` that any web host can serve. The site deploys to Cloudflare Workers from `main`: build command `npm run build`, deploy command `npx wrangler deploy` (configured in `wrangler.jsonc`). See the [launch plan](WEB_PLAN.md#6-hosting-cloudflare-pages).

For phone testing, use an HTTPS host or an HTTPS development setup. A plain HTTP address on your local network cannot provide the exclusive history access the app requires.

### Controls

| Screen | Phone | Desktop keys |
| --- | --- | --- |
| Home | Tap Play, Topics, or Field notebook | Enter plays; P T H; ? help |
| Typing | Type with your keyboard; the pause button, closing the keyboard, or switching apps pauses | Type normally; Backspace erases a character; Alt/Ctrl+Backspace erases a word; Esc pauses; F1 help |
| Question | Tap an answer, then Confirm or Skip | 1–4 select; Enter confirms; S skips; Esc leaves |
| Results | Next round, Home, Details | Enter next; Esc home; ? details |
| Field notebook | Tap a range or topic; Phone / Keyboard filter | ←/→ range; T topic; Enter recent rounds; Esc home |

**Typing tips**

- Mistakes stay on screen until you delete them.
- Type the space after a sentence's final punctuation to move to the next sentence. No Enter needed.
- Shortcut: press Space twice when a sentence's final period is next. Your phone's own ". " double-space shortcut counts too.
- Pasting voids the round.
- Progress saves automatically on the device you play on.

## How it works

**Typing speed.** WPM is correct characters ÷ 5 ÷ active minutes. Pauses don't count against you, but deleting and retyping can't add speed. Accuracy is based on your first attempt at each character.

**Understanding.** Each topic has four levels: 1 Recognize, 2 Explain, 3 Apply, 4 Evaluate. Answer enough questions correctly to move up; repeated misses bring extra review. Questions come back for review after a day, then a week.

**Field notebook.** Two graphs per topic, daily WPM and understanding level, over 30 days, 90 days, 1 year, or all time. Rounds record whether they were typed on a phone or a physical keyboard, and the notebook can show either alone so the two speeds don't mix.

The game includes two topics, ten passages, and eighty questions.

## Your data

The web version keeps history in the browser's IndexedDB on the device you play on. There are no accounts and nothing is sent anywhere. **Data & backup** on the home screen exports CSV files (the same columns as the terminal version's `export` command), downloads a JSON backup, and restores from one. Ask the browser to keep the history permanently from that screen; on iPhone, adding the site to the Home Screen also stops Safari from clearing it after a week away.

If Metabotype is open in two tabs, only one saves at a time; the other offers to take over. This requires Web Locks, available in current browsers over HTTPS (or localhost for development). If the browser cannot provide exclusive access, the game explains the requirement and does not open or modify history.

## Development

```bash
npm test                     # unit tests, including parity fixtures generated from the Python engine
npm run e2e                  # Playwright: desktop Chromium and WebKit, Pixel 7 and iPhone 15 profiles
npm run validate-content
npm run fixtures             # regenerate test/fixtures from cli/ after changing the Python engine
cd cli && python -m unittest discover -s tests -v
```

Open the site with `?debug=input` to record the raw keyboard events your device sends; the **Copy input trace** button puts them on the clipboard so a misbehaving keyboard can be replayed in tests.

Content lives in `content/curriculum.json` and is shared by both versions. See [CONTENT_REVIEW.md](CONTENT_REVIEW.md) for sources and review notes, [PLAN.md](PLAN.md) for the roadmap, and [WEB_PLAN.md](WEB_PLAN.md) for the web design notes.

## License

[MIT](LICENSE) — Copyright (c) 2026 August Allen.
