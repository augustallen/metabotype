# Metabotype project plan

Status: first playable release implemented. See README.md for launch instructions,
CONTENT_REVIEW.md for scientific review notes, and tests/ for acceptance checks.

## Web version (2026-09-13)

- The repository now holds both versions: the terminal game under `cli/` and a static web app at the root, sharing `content/curriculum.json`. The Python engine is the parity oracle: `cli/tools/gen_fixtures.py` records hundreds of scripted typing sessions and the TypeScript port must reproduce every buffer, position and counter (`npm run fixtures`, `npm test`).
- Scoring, learning rules, recommendations and history queries are unchanged; `scoring_version` stays 3. Rounds record `input_method` (phone keyboard or physical keyboard) plus assisted, multi-character and normalized insertion counts, and the notebook can filter by device so the two speeds never mix.
- History is one document in the browser's IndexedDB, replaced whole on every mutation; a failed mutation changes nothing. One tab owns the history at a time (Web Locks, BroadcastChannel fallback); a second tab may take over. Checkpoints are written at sentence boundaries and when the app goes to the background. Interrupted rounds are recovered on load exactly as the CLI does.
- Phone typing uses a hidden text field mirrored from the sentence buffer; each input event is diffed into keystrokes. A phone's automatic ". " on double space is treated as the game's own double-space shortcut. Paste and drop void the round. The timer pauses when the keyboard closes, the field blurs, or the app is hidden; resuming needs an explicit tap. `?debug=input` records raw keyboard events for replay in tests.
- Exports keep the CLI's CSV columns. JSON backups restore by replacing everything, after an automatic backup download.
- Verification: Vitest parity and unit tests; Playwright suites mirroring `cli/tests/test_terminal.py` on desktop Chromium/WebKit and Pixel/iPhone profiles, including offline play and a 320px width check. WebKit runs in CI (it needs system libraries this development machine lacks).
- Still to do: play on real phones (iOS Safari, Android Chrome with Gboard) via a Cloudflare preview URL and commit any captured input traces to `test/fixtures/input/`; connect Cloudflare Pages (build `npm run build`, output `dist`); consider a light theme.

See WEB_PLAN.md for the design notes behind these choices.

## Interface update (2026-09-12)

- Use editable sentences: mistakes remain until deleted, Backspace removes one typed character, and Option/Alt+Backspace or Ctrl+W removes trailing spaces and the preceding word. Correct characters in the current sentence can also be deleted; completed sentences stay locked.
- Advance after the separator space following sentence-ending punctuation is typed correctly. These spaces receive WPM and accuracy credit; the final sentence requires no added trailing space. Scoring version 3 uses net correct text and retains per-position first-attempt outcomes across deletion and retyping. Preserve earlier scores without mixing them into current WPM trends.
- Accept double-space as an optional shortcut for an expected final period plus its separator (or only the period at the end of a passage). Require the preceding text to be correct, preserve other punctuation, and grant credit only for actual target characters. Record an unresolved first space as a pending attempt until resolved; it does not receive WPM credit.
- Keep the app simple: Play, Topics, and Field notebook on home. Play goes directly to typing; omit the pre-round briefing, routine save messages, combo/badge copy, and manual retry menus. Missed concepts return automatically.
- Display spaces as ordinary spaces, with the current space highlighted like any other target character.
- The notebook opens to two graphs for one topic: daily median game WPM and historical end-of-day understanding level. Left/Right cycles through 30 days, 90 days, 365 days, and all time, using the same timeline for both graphs. Long WPM histories group daily medians while preserving their calendar positions; understanding keeps every level change. Lines connect observations across missed days without inventing scores. Use responsive framed panels, teal WPM curves, amber understanding steps, and dated latest values. Tab changes topic; Enter opens recent rounds. Keep exports on the command line.
- Remove the weekly benchmark. Preserve older records for export, but use ordinary game rounds for progress charts. No history reset or schema migration is needed.

## Implemented refinements

- The initial topics are metabolomics foundations and biological/study context: ten passages and eighty questions (two per concept at every level).
- Immediate repeated questions are review-only. Questions last shown at least 24 hours ago may supply explicitly labeled delayed reassessment evidence; five distinct IDs are still required within a promotion window. This refines the original lifetime exclusion below so a finite bank does not permanently block progress. New content versions do not erase prior familiarity.
- Skips and ineligible attempts preserve the error streak. Reviews are per concept; difficulty is per topic. One-day review follows a correct eligible answer; the seven-day interval starts after the successful one-day check. Early practice does not move due dates.
- Completed passages record concept exposure. Recommendations check passage and question prerequisites before selecting a pair.
- Typing completion and quiz completion have separate statuses. Completed valid typing counts in trends even if its quiz is unfinished. Crashes preserve partial results only through the last sentence checkpoint; intentional aborts save current counts.
- F1 opens help during typing, leaving literal question marks usable. Sentence separator spaces must be typed before advancing. Zero-duration samples have no WPM. Resizing pauses only when the terminal is smaller than 80 x 24.
- Bracketed paste aborts scoring and is drained before navigation resumes. Unmarked paste cannot be reliably detected and is documented as a limitation.
- Curriculum files are package data under src/metabotype/data/ so installed and standalone zipapp builds work offline outside the source directory. Structural validation and content checks ship with the first release.

The original design below remains the roadmap; the refinements above take precedence where its initial rules differ.

## Purpose

Build a quick, keyboard-only terminal game that develops typing fluency while teaching the fundamentals of metabolomics. Each round combines a short educational passage with a brief comprehension question. Question difficulty adapts to demonstrated understanding, and local history shows typing and learning progress over time.

Success means a user can launch the game, complete a useful round in roughly two minutes, understand their result, and return later with their history and learning progress intact.

## First-version decisions

- Use the working name `metabotype`.
- Build in Python with the standard-library `curses` interface and SQLite storage. Target Linux first, including the user's current terminal environment.
- Keep lessons, questions, scoring, and progress available offline. No accounts, remote services, or generated questions during play.
- Use curated, source-reviewed educational content stored separately from application code.
- Keep typing performance and comprehension performance separate. Faster typing does not unlock harder questions.
- Prefer finishing a passage over racing a countdown. There is no time limit on answering questions.
- Save each completed stage immediately; do not depend on a clean application exit.

## Round flow

1. **Choose practice.** Default to a recommended lesson; allow choosing a topic or reviewing a missed concept.
2. **Type a passage.** Show a topic and approximately 60–90 words. Reveal one sentence at a time, with the current character and errors clearly marked. Show live WPM and first-attempt accuracy.
3. **Check understanding.** Hide the passage and present one multiple-choice question with three or four options. Answer using number keys and confirm with Enter.
4. **Get feedback.** Show WPM, accuracy, mistake counts, and the comprehension result separately. Explain the correct answer and, where useful, why the selected distractor is wrong.
5. **Continue or exit.** Enter starts the next recommended round; Escape returns home. Missed concepts are revisited through recommendations.

The home screen provides Practice, Topics, History, and Quit. All screens must work without a mouse. Help remains available through `?`; Escape opens a pause/exit menu during typing. Resizing the terminal automatically pauses timing until the layout is usable again. Use more than color alone to indicate errors and selection.

## Typing behavior and measurement

Use an editable sentence buffer. Wrong printable characters remain until deleted; typing the expected character does not overwrite an error. Backspace deletes one character and Option/Alt+Backspace or Ctrl+W deletes a word. A sentence advances only when the whole buffer matches the target. Completed sentences stay fixed.

- Start timing with the first printable typing attempt, including an incorrect one.
- Stop timing when the final target character is accepted.
- Use a monotonic clock for duration. Exclude explicit pauses, question time, and results screens; ordinary hesitation during typing still counts.
- **WPM:** `(accepted target characters / 5) / active minutes`. Include spaces between and within sentences, plus punctuation. Count completed sentences plus the current correct prefix; deleted and retyped characters never add extra credit.
- **First-attempt accuracy:** target positions entered correctly on their first printable attempt divided by total attempted target positions, multiplied by 100.
- **Mistakes:** count every incorrect printable attempt, including repeated errors at the same position. Also record correct printable attempts and backspace count so later reporting does not have to infer them.
- Ignore navigation and other non-text keys for accuracy. Do not permit pasted text to produce a scored round; detect bracketed paste where supported and explain the restriction.
- If a round is aborted, retain its partial statistics with an explicit status; exclude it from normal WPM records and trends.
- Replaying the same passage is allowed, but mark the attempt as a repeat.

Use simple ASCII lesson text initially to avoid ambiguous character counting and terminal-width behavior. Include scientific notation only where the terminal can render it clearly.

## Adaptive comprehension

Track understanding independently for each topic. Typing speed, spelling errors, and answer response time never lower or raise comprehension difficulty.

### Question levels

| Level | What it tests | Question design |
| --- | --- | --- |
| 1: Recognize | Basic terms and distinctions | Choose the meaning of a term or identify the relevant measurement. |
| 2: Explain | Relationships and consequences | Choose why a method or control is useful. |
| 3: Apply | Transfer to a short unfamiliar scenario | Select an appropriate approach or identify a confounding influence. |
| 4: Evaluate | Interpret evidence and limitations | Choose the best-supported conclusion from a small study description. |

Harder questions require more reasoning, not obscure vocabulary, trick wording, or longer answers. Every question has one defensible best answer, plausible distractors, an explanation, prerequisites, and a content source. Do not test facts the learner has not yet encountered unless the question supplies them.

### Initial promotion and support rules

- Start each new topic at level 1.
- Promote one level after at least four correct answers among the last five eligible questions at the current level, with the most recent two correct.
- A promotion window must contain five distinct question IDs. Repeated questions remain useful practice but do not count as new evidence for promotion.
- After two consecutive wrong answers at the current level, move down one level and schedule a short review. At level 1, stay there and provide simpler reinforcement.
- Reset the promotion window and wrong-answer streak when changing levels, so earlier success cannot cause several automatic promotions.
- A skipped question receives an explanation and enters review, but is neither a correct nor a wrong answer for level changes.
- A question shown with its answer already revealed is review-only and cannot establish mastery.
- A correct answer on a new question about the concept clears an immediate review item. Revisit the concept after approximately one day and one week to check retention.
- A missed delayed review returns the concept to immediate review. It affects difficulty only if it is at the learner's current level.
- At the highest level, continue varied application and evaluation practice rather than claiming the topic is permanently mastered.

For recommended practice, prioritize a recently missed concept, then due review, then new work in the current topic. Avoid more than two consecutive review rounds when other eligible lessons are available. Let users select another topic at any time and see a short reason for recommendations and level changes.

These thresholds are initial, configurable rules to evaluate during playtesting. Multiple-choice guessing makes a single correct answer weak evidence, so promotion requires repeated success across distinct questions. If the question bank is exhausted, offer labeled review or another topic; do not invent additional difficulty or count repeats as fresh evidence.

## Curriculum and content scope

Begin with these topic groups:

1. Metabolites, metabolism, and what metabolomics studies.
2. Biological variation, diet, medication, and other influences.
3. Targeted and untargeted study approaches.
4. Basic roles of mass spectrometry, chromatography, and NMR.
5. Sample handling, controls, quality control, and batch effects.
6. Interpreting results: identification uncertainty, association, and causation.

Build a vertical slice with two topics first. For each topic, provide five short passages and at least five distinct questions at each of the four levels: ten passages and forty questions total. This supports actual promotion without reusing the same question as evidence. Expand to the remaining topics once the loop and adaptation work well.

Store stable IDs, content versions, topic/concept tags, prerequisites, difficulty, passage compatibility, answer options, the correct option ID, explanations, and source links in content files. Randomize option display order while preserving stable option IDs in logs. Validate uniqueness, answer correctness, prerequisites, and sufficient questions for promotion.

Before shipping lesson content, check metabolomics claims against authoritative educational or primary sources. This plan defines the curriculum and behavior; it is not a scientific content review.

## Local history and persistence

Use SQLite as the durable event log and source of truth. Keep it under `$XDG_DATA_HOME/metabotype/history.sqlite3`, falling back to `~/.local/share/metabotype/history.sqlite3`. Support a configurable data directory for testing and portable use. Create the database on first launch without a setup wizard.

Record:

| Record | Fields |
| --- | --- |
| Session | ID, UTC start/end timestamps, application version |
| Round | ID, session ID, topic/concept, passage ID/version, start/completion timestamps, status, repeat flag, typing difficulty metadata |
| Typing result | Active duration, target and accepted character counts, first-attempt correct positions, attempted positions, incorrect attempts, backspaces, pause duration, WPM, accuracy, scoring version |
| Question attempt | Question ID/version, level, displayed option order, selected option ID, correct/wrong/skipped status, response duration, eligibility for adaptation |
| Learning state | Per-topic level, evidence window, error streak, review due times, last practiced time |
| Learning transition | Previous/new level, triggering round, reason, adaptation algorithm version |

Save the typing result before showing the question. Save the answer and corresponding learning-state updates together in a transaction. Preserve a completed typing result if the app closes before the quiz. Update a lightweight checkpoint at sentence boundaries for partial rounds; after a crash, mark unfinished rounds interrupted and offer a fresh round rather than resuming an unreliable timer.

Keep raw counts and durations alongside derived metrics. Schema migrations and scoring versions must preserve old records and make incompatible measurements distinguishable. Do not log unrelated keyboard input or require a complete keystroke trace.

## History screens and WPM trends

- **Recent rounds:** date, topic, WPM, first-attempt accuracy, mistakes, question level, and comprehension result.
- **Typing progress:** personal best for a completed passage, median WPM for the latest ten eligible rounds, and change from the preceding ten.
- **Time view:** daily median WPM, defaulting to 30 days with longer ranges through all time. Days without practice are gaps. Alongside it, graph the historical end-of-day understanding level per topic, carrying established levels forward across inactive days.
- **Learning progress:** graph the recorded level over time for the selected topic; keep detailed events in local history and exports.
- **Topic selection:** Tab switches the notebook graphs between topics while retaining the selected time range. Both graphs use matching dates.
- **Export:** CSV files for rounds and question attempts, preserving stable IDs so users can join them later.

Label small samples honestly: show counts and an insufficient-history message instead of claiming improvement before two full ten-round windows exist. Calculate daily summaries in the user's local timezone while storing timestamps in UTC. Only compare compatible scoring versions and typing modes.

Passage length, punctuation, terminology, and familiarity can change WPM. Track progress through ordinary game passages. Display accuracy with round scores so faster typing with more mistakes is visible.

## Implementation structure

- `src/metabotype/ui/`: keyboard input, layouts, screens, terminal lifecycle.
- `src/metabotype/typing.py`: typing state and metrics, independent of terminal rendering.
- `src/metabotype/learning.py`: adaptation rules, review scheduling, recommendations.
- `src/metabotype/storage.py`: transactions, migrations, queries, exports.
- `src/metabotype/content.py`: content loading and validation.
- `content/`: versioned passages and question banks.
- `tests/`: deterministic scoring, adaptation, and persistence checks.

Inject the clock into timing and scheduling logic so tests do not depend on real waiting. Keep tuning values in one place. Provide a terminal entry point, a content validation command, and export commands with documented usage.

## Build sequence and acceptance checks

1. **Playable vertical slice.** Implement one passage, one question, feedback, and keyboard navigation. A user can finish a round, pause, resize, and quit; the terminal is restored cleanly on exit.
2. **Reliable scoring and persistence.** Implement the metric definitions and database. Verify known keystroke/timing sequences, corrected mistakes, pauses, and recovery after interruption. Completed typing results survive closing before the quiz.
3. **Adaptive learning.** Add the two-topic content bank and versioned learning state. Test promotion, support after mistakes, independent topic levels, skips, repeated question exclusion, retention scheduling, and exhausted question banks.
4. **History and export.** Add recent results, WPM and understanding graphs, learning history, and command-line CSV export. Verify date boundaries, missing days, small samples, version filtering, and restart persistence using fixture histories.
5. **Content review and usability.** Review scientific claims and answer ambiguity, playtest question difficulty, check a normal 80×24 terminal and smaller-window pause behavior, and document installation and data location.

The first release is ready when a user can complete multiple rounds, earn a justified difficulty increase, revisit a missed concept, restart without losing progress, and inspect a truthful WPM trend using only the keyboard.

## Deferred features

Countdown sprints, free-text grading, runtime AI content generation, accounts or cloud sync, leaderboards, elaborate achievements, and additional typing modes are outside the first version. Expand the curriculum and adjust adaptive thresholds based on playtesting before adding these features.
