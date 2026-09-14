# Metabotype web: mobile-first design notes

> Status (2026-09-13): implemented in this repository on the `web` branch. The project kept the name
> Metabotype and lives in the original repo with the terminal game under `cli/`. PLAN.md records what
> shipped; this document keeps the design reasoning and the review notes.
> Editorial update (2026-09-13): every passage now has five sentences. The five longer passages
> were shortened to 50–52 words; validators allow 50–90 words. The original length target below
> remains part of the design history.

## Context

Metabotype (`~/Projects/metabotype`) is a Python curses + SQLite terminal game. You type a 60–90 word metabolomics passage sentence by sentence, answer an adaptive multiple-choice question, and track WPM and understanding in a field notebook. It needs an 80×24 terminal and a physical keyboard, so nobody can play it on a phone. Metabotyper is a hostable website that plays well with a phone's on-screen keyboard and is also first-class on desktop. It keeps the game's scoring, learning rules and reviewed content exactly as they are.

**Decisions made**
- **Project:** `~/Projects/metabotype`, using the existing `augustallen/metabotype` GitHub repository and its `web` branch. The earlier separate-repository proposal was dropped; the app and site keep the name Metabotype.
- **The terminal game lives on inside this repo** as `cli/`, sharing `content/curriculum.json` with the web game.
- **Stack:** static TypeScript with Vite and Preact (+ signals), no backend, no client-side router (screens are state, exactly as in the curses app). `curriculum.json` is reused byte-for-byte. The Python tests are the behavioral spec.
- **Progress** stays on the device, no accounts. CSV export plus JSON backup/restore.
- **Input:** phone on-screen keyboard is primary; desktop keeps Esc, F1, arrows, 1–4, Enter.
- **Hosting:** Cloudflare Pages connected to the GitHub repo. Every branch push gets an HTTPS preview URL, which doubles as the way to test on a real phone (no mkcert or tunnels needed).

## Review notes (what changed from the first draft)

1. **Front-load the risk.** The first draft built the desktop UI before touching phone input. Phone typing is the one part that can sink the project, so it's now built and tested on a real phone in the first playable phase, using Cloudflare preview URLs.
2. **Simpler storage.** `storage.py` already loads whole tables and filters in memory. The web version keeps one in-memory model and persists it as a single document in IndexedDB. Every write is atomic by construction, "rollback" is just not committing a failed mutation, and the SQLite transaction choreography disappears. Data volume is kilobytes per hundred rounds; a per-sentence write of the whole document is fine into the thousands of rounds.
3. **Keep the Python, share the content.** Because the terminal version will merge in, the repo is laid out as `content/` + `cli/` + web at the root, and the Python suite stays as a permanent cross-implementation oracle rather than a temporary reference.
4. **Ship a shareable input recorder.** Trace capture isn't limited to the phones you own: `?debug=input` ships in production, so a friend with a Samsung or SwiftKey keyboard can send you a trace when something misbehaves.
5. **Trim the test matrix.** CDP IME composition tests and the Samsung/SwiftKey captures are optional. Trace replay in Vitest is the required check; Playwright covers desktop Chromium/WebKit and one phone profile.
6. **No client routing** means no SPA-fallback config on Cloudflare and no scope problems for the service worker.

## Project layout

```
metabotyper/
  index.html  vite.config.ts  tsconfig.json  vitest.config.ts  playwright.config.ts  package.json
  public/_headers                  # Cloudflare: no-cache for sw.js and index.html, immutable hashed assets
  content/curriculum.json          # canonical, git mv from cli/src/metabotype/data/, unchanged
  cli/                             # the terminal game: git mv of src/, tests/, metabotype.py, pyproject.toml, scripts/
    src/metabotype/data/curriculum.json -> ../../../../content/curriculum.json   (symlink)
    tools/gen_fixtures.py          # emits JSON parity fixtures from the Python implementation
  src/core/     typing.ts learning.ts practice.ts content.ts stats.ts charts.ts time.ts rng.ts
  src/storage/  model.ts (in-memory document + mutations) persist.ts (IDB single-document) lock.ts export.ts backup.ts
  src/input/    reconcile.ts (pure reducer) typing-field.ts (DOM) shortcuts.ts recorder.ts
  src/ui/       app.tsx, screens/{Home,Topics,Typing,Pause,Quiz,Results,Details,Notebook,Rounds,Help,Data,OtherTab}.tsx,
                charts/{LineChart,StepChart}.tsx, motion.css
  test/unit  test/fixtures  test/e2e
```
- Tag the starting commit `cli-v0.4.1`.
- `validate-content` becomes `npm run validate-content`. `export` and `stats` move to a Data screen. The Python CLI keeps its own commands.
- README gets a web section (play URL, phone tips) and keeps the terminal instructions under `cli/`.

## 1. Core port: behavior must be identical

| Python | TS | Must stay identical |
|---|---|---|
| `typing.py` `TypingState` | `core/typing.ts` | Boundary regex `/[.!?] +/g` (the separator space belongs to the sentence). `position` is the correct prefix; `error` is the remainder. Word delete strips trailing spaces, then cuts to the last space. `pending_period` double-space semantics, including the final-period extra `correct += 1`. `started` is set on the first printable key; pause accumulates only after start. `wpm = accepted*12/duration`. First-attempt accuracy. snake_case metric keys, `scoring_version: 3`, `typing_mode: "editable-sentences"`. Injected clock in seconds. |
| `learning.py` | `core/learning.ts` | Direct port: `WINDOW=5`, `ALGORITHM_VERSION=1`, exact reason strings, returns new objects. |
| `practice.py` `recommend` | `core/practice.ts` | Pure function over the in-memory model. Same 9-tuple lexicographic score and priority rules. Seeded mulberry32 in tests. |
| `content.py` | `core/content.ts` | Same checks in the same order. `split()` becomes `trim().split(/\s+/)`. |
| `storage.py` queries | `core/stats.ts` | `eligibleRounds`; `summary` with Python-style median and `change` only at ≥ 20 rounds; `historyDays`; `daily`; `understandingDaily` carries levels forward from `(created, id)`-ordered transitions. |
| local dates | `core/time.ts` | Local-date keys and a DST-safe day difference via `Date.UTC`. |
| `charts.compact_series` | `core/charts.ts` | Exact port. `chart_rows` is replaced by a pure `chartGeometry()` that feeds SVG. |

Dropped: `ui/input.py` (bracketed paste), the 80×24 `wait_size`, `chart_rows`/`notebook_symbols`.

## 2. Storage: one document, in memory, persisted whole

- **Model** (`storage/model.ts`): `{schema_version: 1, sessions, rounds, questions, learning, reviews, exposure, transitions, meta}` with the same fields as the SQL tables (`metrics` and `option_order` as real objects, epoch-second timestamps so CSVs match the CLI). `transitions` keeps an incrementing `id` for `(created, id)` ordering.
- **Mutations** are synchronous functions on the model (`beginRound`, `saveTyping`, `showQuestion`, `answer`, `abandonQuiz`, `startSession`) that validate first and throw before touching anything, so a failed `answer()` leaves the model untouched. Each mutation ends with `persist()`.
- **Persist** (`storage/persist.ts`): the whole model as one record in one IndexedDB store, written through a serial queue (last write wins, in order). Load once on start. If the document grows past ~2 MB, shard rounds by month; not needed now.
- **Checkpoints and recovery:** persist at every sentence boundary and on `visibilitychange → hidden` (mobile browsers kill background tabs). On load, `startSession()` marks `typing`/`quiz` rounds `interrupted` (active → partial), sets pending questions `unanswered`, and Home shows "Recovered N unfinished round(s)…".
- **Multi-tab safety** (replaces `fcntl`): hold the Web Locks `metabotype-owner` lock for the tab's lifetime. A second tab shows OtherTab with a **Use here** button (`steal: true`); the loser goes read-only and drops its in-memory model. BroadcastChannel is the fallback where Web Locks is missing.
- **Eviction:** call `navigator.storage.persist()` after the first completed round and from the Data screen. On iOS Safari, a one-time "Add to Home Screen" hint (Safari clears a site's script storage after 7 days without a visit unless the app is installed). A gentle backup nudge lives on the Data and Notebook screens, never after a round (PLAN.md: no routine save messages).
- **Export and backup:** `rounds.csv` / `question_attempts.csv` in the CLI's column order, timestamped; `navigator.share({files})` on phones. JSON backup is the model itself plus `app_version` and `exported_at`. Import is "Replace all" only, after an automatic backup download and a confirmation.

## 3. Phone text input (the hard part)

- **Field:** one persistent hidden `<input>` at the app root. `autocomplete/autocorrect/autocapitalize="off"`, `spellcheck="false"`, `enterkeyhint="next"`, `font-size:16px` (no iOS zoom), `opacity:0`, never `display:none`. Focus runs synchronously inside the tap handler (Play, topic card, Next round, Resume); with the synchronous model there are no awaits in the way. A "Tap to type" overlay appears whenever the field loses focus mid-round.
- **Mirror model** (`input/reconcile.ts`, a pure reducer): the field always mirrors `buffer` (+ `" "` while `pending_period` is set). On each `input` event, diff old vs. new value and emit `TypingState.feed()` keys:
  - **Paste/drop** (`insertFromPaste`, `insertFromDrop`): `preventDefault`, mark the round invalid, save as aborted (the terminal's paste rule). Also `preventDefault` `historyUndo`/`historyRedo`.
  - **OS double-space period** (iOS, Gboard): `prev` ending in `" "` → `prev.slice(0,-1) + ". "` is emitted as one `" "`, which resolves the game's own shortcut exactly.
  - **Deletions:** `deleteWord*`, or a multi-char removal equal to a word delete, → `WORD_BACKSPACE`; else `BACKSPACE × n`.
  - **Insertions:** per character; smart quotes → ASCII (`autocorrect=off` does not disable iOS smart punctuation, and the content has one apostrophe), astral → U+FFFD. Predictions (`insertReplacementText`) go through the same diff and are counted.
  - **Composition** (swipe, IME): diffed live; the field isn't rewritten until `compositionend`.
- Force the caret to the end on `selectionchange` (defeats the iOS space-bar trackpad). Control keys come from `keydown` only when not composing and `keyCode !== 229`; text never comes from keydown. Ctrl+W closes browser tabs, so help says Alt/Ctrl+Backspace.
- **Pause triggers:** Esc/pause button, tab hidden, window or field blur (iOS "Done", Android back), keyboard dismissed (visualViewport grows ≥ 150px). Resume needs an explicit tap or key and refocuses the field. This replaces the resize pause.
- **Layout:** `interactive-widget=resizes-content` plus `--vvh`/`--vvtop` from `visualViewport`, so the typing screen fills exactly the space above the keyboard: header → WPM/accuracy → current sentence (18px mono; word spans keep scored spaces; the longest sentence is 143 chars ≈ 5 lines at 360px) → error hint → progress.
- **Phone vs. desktop trends:** scoring is unchanged, so `scoring_version` stays 3. New metrics: `input_method` (`touch`|`keyboard`: virtual keyboard seen or keyCode 229 arrived), `assisted_insertions`, `multi_char_insertions`, `normalized_characters`. Notebook gets a Touch / Keyboard / All filter defaulting to the current device.
- **Recorder** (`input/recorder.ts`): `?debug=input` logs `beforeinput`/`input`/composition/`keydown`/`selectionchange` as copyable JSON. It ships in production so anyone can send a trace.

## 4. Screens

Tap targets ≥ 48px; primary actions in a sticky bottom bar with safe-area padding; desktop shortcut hints only for fine pointers.

- **Home:** Play, Topics, Field notebook; recovery notice; Help; small "Data & backup" link.
- **Topics:** cards with title, subtitle, "Level n / Name". Tapping plays.
- **Typing:** correct = green; errors = red + underline + tint (never color alone); inverted cursor character including spaces; live WPM after 1s; touch-worded error hint.
- **Pause:** bottom sheet with Resume, Help, Leave round.
- **Quiz:** keyboard dismissed; full-width shuffled option buttons; Confirm (disabled until selected) and Skip in the bottom bar; 1–4 / Enter / S / Esc on desktop.
- **Results:** Correct! / Not quite / Skipped, big WPM and accuracy, level, answer and explanation. Next round (focuses the field), Home, Details (passage + source links). No save/combo/retry copy.
- **Notebook:** topic control, 30d / 90d / 1y / All sliding tabs (persisted), input-method filter. SVG typing line chart (`compactSeries`, calendar positions, played days connected, markers when sparse, Python y-range formula, teal) and SVG understanding step chart (levels 1–4, amber). Latest-value summaries, empty states, 1–3 date labels with `'yy` when years differ, midnight refresh, `role="img"` + hidden data table.
- **Recent rounds:** list with the "(earlier typing rules)" note and an input-method badge.
- **Help:** rewritten for touch and desktop. **Data:** persistence status, CSV export, backup/restore, `summary()` stats. **OtherTab:** another tab owns the data.
- Known limitation: a hidden-input typing game isn't screen-reader playable; the notebook and quiz are accessible.

## 5. Motion and polish (transitions.dev)

transitions.dev (Jakub Antalik) is a curated set of CSS-first transitions that animate only transforms/opacity and guard with `prefers-reduced-motion`. Individual transitions may be used in any project, but the code isn't MIT and the collection can't be redistributed. Metabotyper is a public MIT repo, so the handful used are **re-implemented in our own `motion.css`** with our own tokens. Pro isn't needed.

| Pattern | Where |
|---|---|
| Number pop-in | Results WPM/accuracy; live WPM ticker |
| Text states swap (blur cross-fade) | Next sentence; Correct! / Not quite title |
| Error state shake | Wrong character (off under reduced motion) |
| Success check | Correct quiz answer |
| Tabs sliding | Notebook range tabs and topic switcher |
| Page side-by-side | Home → Typing → Quiz → Results (View Transitions API, CSS fallback) |
| Modal / panel reveal | Pause sheet, Help, Details |
| Notification badge | "Level up!" |
| Skeleton → reveal | Notebook charts while loading |

Tokens 150/220/320ms, one standard and one emphasized easing; only transform/opacity/filter animate; instant under `prefers-reduced-motion`; nothing delays per-keystroke feedback.

## 6. Hosting: Cloudflare Pages

Deployment plan agreed 2026-09-13; hosting has not been configured or deployed yet.

1. **Save the release candidate.** Commit and push the latest code, tests, and this plan to `web` in `augustallen/metabotype`. Run the existing CI checks before deployment.
2. **Publish an HTTPS preview.** Connect that GitHub repository to Cloudflare Pages, with `main` as the production branch and preview deployments enabled for `web`. Use the repository root, Node 22, build command `npm run build`, and output directory `dist`. Keep the existing relative asset base (`./`) and `public/_headers` caching rules. Scope the GitHub connection to this repository.
3. **Check the hosted game.** On the preview URL, verify first-load keyboard control, arrow selection, Enter confirmation, five sentences before each question, real-phone typing, and saved progress after reload. Check pause/recovery, offline play after the first visit, and backup/restore before launch. Preview and production URLs have separate browser histories; use JSON export/import to move test progress if wanted.
4. **Launch.** After the preview checks, merge `web` into `main` to publish the production site. Start with the assigned `pages.dev` address; a custom domain can follow. Future production-branch pushes deploy automatically. Record the live URL in README.md after deployment succeeds.

This is a static site: no backend, accounts, or hosted database are needed. Progress stays in each player's browser. Keep analytics and additional game modes out of this launch; GitHub Pages remains a fallback.

Configuration reference: [Cloudflare Pages Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/).

## 7. Build phases and acceptance checks

0. **Scaffold.** Tag, `git mv` into `content/` and `cli/` (+ symlink), Vite + TS strict + Preact + Vitest + Playwright + ESLint, CI, `_headers`, create the GitHub repo, connect Cloudflare.
   - Accept: `npm run build` deploys as a preview; `python -m unittest` still passes under `cli/`.
1. **Core parity.** Port `TypingTests`, `LearningTests`, `ContentTests` and `compact_series` tests from `cli/tests/test_core.py`. `gen_fixtures.py` records ~500 seeded key sequences (typos, spaces, deletes, pauses, scripted clock) through the Python `TypingState`.
   - Accept: TS replay matches every fixture; `validate-content` reports 2 / 10 / 80.
2. **Model + storage + recommend.** Port `StorageTests` onto the in-memory model with fake-indexeddb and an injected clock (America/Denver DST test via `process.env.TZ`), double-answer rejection, recovery counts, `history_days` cases; lock tests; CSV column parity; backup roundtrip.
3. **First playable, phone and desktop.** Hidden field + `reconcile.ts` + Typing/Quiz/Results/Home screens, minimal styling. Deploy the preview and play it on your phone the same day.
   - Accept (Vitest): reconcile unit tests for the double-space period, word delete, paste, smart quotes.
   - Accept (Playwright desktop Chromium + WebKit, ports of `cli/tests/test_terminal.py`): full round → complete at 100% accuracy; paste → invalid/aborted; Esc pause/resume; reload during quiz → recovery; checkpoint after the separator space; double-space shortcut; second tab → OtherTab.
   - Accept (manual, your phone): a full round at 100% accuracy with the keyboard staying open between sentences.
4. **Phone input hardening.** Capture traces with `?debug=input` on your iPhone/Android (plain, double-space, predictions, smart apostrophe, hold-delete, swipe, dictation) and any friend's keyboard; commit to `test/fixtures/input/`; Vitest replays each trace through `reconcile.ts`. Playwright Pixel 7 / iPhone profile for blur/visibility pause.
   - Accept: every trace yields the expected buffer and metrics.
5. **Notebook, Data, PWA, motion.** SVG charts and the ported `cli/tests/test_ui.py` render checks (range cycle persistence, date labels, single-day marker, empty states, midnight rollover, 500-x word delete). `vite-plugin-pwa` (precache all, prompt-to-update, never mid-round), manifest/icons, persist flow, iOS install hint, `motion.css`.
   - Accept: Playwright plays a full round offline; no horizontal overflow at 320px with rendered sentence == target; Lighthouse installable, Performance ≥ 90, Accessibility ≥ 95; axe clean.
6. **Release.** Manual checklist on real devices via the preview URL: background/lock-screen pause; tab killed mid-round → recovered; install to home screen and play offline; export/backup/restore; rotation mid-round; iPad hardware keyboard. Then merge to `main` for the production URL, and update README/PLAN.md.

## Verification summary

- `npm test`: Vitest parity with Python fixtures; ported unit, model and render tests; input trace replays.
- `npm run e2e`: Playwright desktop Chromium/WebKit plus a phone profile, including offline.
- `npm run validate-content`; `cd cli && python -m unittest`.
- Lighthouse and axe on the production build; the manual real-phone checklist on the preview deploy.
