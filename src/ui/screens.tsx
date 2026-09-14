/** Every screen of the game. Each one reads signals from Game and registers its own desktop shortcuts. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { LEVELS } from '../core/learning.ts'
import { msUntilLocalMidnight, stamp } from '../core/time.ts'
import { Store } from '../storage/store.ts'
import { questionAttemptsCsv, roundsCsv, exportStamp } from '../storage/export.ts'
import { makeBackup, parseBackup } from '../storage/backup.ts'
import { requestPersistence, storageStatus, type StorageStatus } from '../storage/persist.ts'
import { HISTORY_RANGES, type Game, type InputMethod } from './game.ts'
import { Button, Frame, Kbd, Page, Sheet, metric } from './components.tsx'
import { useFinePointer, useKeys } from './hooks.ts'
import { LineChart, StepChart } from './charts.tsx'
import { deliver, pickFile } from './download.ts'

/* ---------- Home ---------- */

export function Home({ game }: { game: Game }) {
  const items: [string, string, () => void][] = [
    ['p', 'Play', () => game.play()],
    ['t', 'Topics', () => game.navigate('topics')],
    ['h', 'Field notebook', () => game.navigate('notebook')],
  ]
  const [selected, setSelected] = useState(0)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  useLayoutEffect(() => {
    // Give the initial menu a keyboard target, including when a reload restores
    // focus to the inactive typing field. Preserve focus on other controls.
    const active = document.activeElement
    if (!active || active === document.body || active === document.documentElement || active === game.field.el) {
      buttons.current[0]?.focus({ preventScroll: true })
    }
  }, [])
  const move = (step: number) => {
    const focused = buttons.current.findIndex((button) => button === document.activeElement)
    const next = ((focused >= 0 ? focused : selected) + step + items.length) % items.length
    buttons.current[next]?.focus()
  }
  useKeys((e) => {
    const key = e.key.toLowerCase()
    if (key === 'arrowdown' || key === 'j') { move(1); return true }
    if (key === 'arrowup' || key === 'k') { move(-1); return true }
    if (key === 'enter') { items[selected][2](); return true }
    if (key === '?') { game.openHelp(); return true }
    const item = items.find((x) => x[0] === key)
    if (item) { item[2](); return true }
    return false
  }, [selected])
  const notice = game.notice.value
  const update = game.updateReady.value
  const install = useInstallHint(game)
  return (
    <Frame title="Metabotype" hideTitle hint={<Kbd>Enter plays · P T H · ? help</Kbd>}>
      <p class="tagline">Small molecules. Steady fingers.</p>
      <p class="lede">Type a short passage, answer a metabolomics question, and watch your progress in the field notebook.</p>
      <nav class="menu" aria-label="Main menu">
        {items.map(([key, title, action], i) => (
          <button key={key} type="button" class={`menu-item ${i === selected ? 'selected' : ''}`}
            ref={(button) => { buttons.current[i] = button }}
            onClick={action} onFocus={() => setSelected(i)} onMouseEnter={() => setSelected(i)}>
            <span class="menu-key">{key.toUpperCase()}</span>
            <span class="menu-title">{title}</span>
          </button>
        ))}
      </nav>
      {notice ? <p class="notice" role="status">{notice}</p> : null}
      {game.saveError.value ? <p class="notice warn" role="alert">{game.saveError.value}</p> : null}
      {update ? <p class="notice"><button type="button" class="link" onClick={update}>A new version is ready. Tap to update.</button></p> : null}
      {install ? <p class="notice">On iPhone, use Share → <strong>Add to Home Screen</strong> so Safari keeps your history and the game works offline. <button type="button" class="link" onClick={install}>Got it</button></p> : null}
      <p class="foot-links">
        <button type="button" class="link" onClick={() => game.openHelp()}>Help</button>
        <span aria-hidden="true"> · </span>
        <button type="button" class="link" onClick={() => game.navigate('data')}>Data &amp; backup</button>
      </p>
    </Frame>
  )
}

function useInstallHint(game: Game): (() => void) | null {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean }
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) && !/CriOS|FxiOS/.test(navigator.userAgent)
    const standalone = nav.standalone === true || matchMedia('(display-mode: standalone)').matches
    const rounds = game.store.model.rounds.filter((r) => r.status === 'complete').length
    setShown(ios && !standalone && !game.store.model.meta.install_hint_shown && rounds >= 1)
  }, [game, game.screen.value])
  if (!shown) return null
  return () => {
    game.store.setMeta({ install_hint_shown: true })
    setShown(false)
  }
}

/* ---------- Topics ---------- */

export function Topics({ game }: { game: Game }) {
  const ids = Object.keys(game.content.topics)
  const [selected, setSelected] = useState(Math.max(0, ids.indexOf(game.topic.value ?? '')))
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const move = (step: number) => {
    const focused = buttons.current.findIndex((button) => button === document.activeElement)
    const next = ((focused >= 0 ? focused : selected) + step + ids.length) % ids.length
    buttons.current[next]?.focus()
  }
  const choose = (tid: string) => {
    game.topic.value = tid
    game.play(tid)
  }
  useKeys((e) => {
    const key = e.key.toLowerCase()
    if (key === 'escape') { game.navigate('home'); return true }
    if (key === 'arrowdown' || key === 'j') { move(1); return true }
    if (key === 'arrowup' || key === 'k') { move(-1); return true }
    if (key === 'enter') { choose(ids[selected]); return true }
    if (/^[1-9]$/.test(key) && Number(key) <= ids.length) { buttons.current[Number(key) - 1]?.focus(); return true }
    if (key === '?') { game.openHelp(); return true }
    return false
  }, [selected])
  return (
    <Frame title="Topics" back={() => game.navigate('home')} hint={<Kbd>↑↓ choose · Enter plays · Esc back</Kbd>}>
      <div class="cards">
        {ids.map((tid, i) => {
          const topic = game.content.topics[tid]
          const state = game.store.state(tid)
          return (
            <button key={tid} type="button" class={`card ${i === selected ? 'selected' : ''}`} onClick={() => choose(tid)}
              ref={(button) => { buttons.current[i] = button }}
              onFocus={() => setSelected(i)} onMouseEnter={() => setSelected(i)}>
              <span class="card-number">{topic.number}</span>
              <span class="card-title">{topic.title}</span>
              <span class="card-subtitle">{topic.subtitle}</span>
              <span class="card-level">Level {state.level} / {LEVELS[state.level]}</span>
            </button>
          )
        })}
      </div>
    </Frame>
  )
}

/* ---------- Typing ---------- */

export function Typing({ game }: { game: Game }) {
  void game.tick.value
  const round = game.round.value
  const fine = useFinePointer()
  if (!round) return null
  const state = round.typing
  const m = state.metrics()
  const [index, start, end] = state.sentence()
  const target = state.target.slice(start, end)
  let text = state.buffer + target.slice(state.buffer.length)
  if (state.buffer.length >= target.length) text += ' ' // keep an insertion cursor after an overlong typo
  const words = useMemo(() => splitWords(text), [text])
  const liveWpm = m.active_duration >= 1 ? m.wpm : null
  const progress = Math.floor((100 * state.position) / state.target.length)
  const focused = game.field.focused
  const paused = game.overlay.value !== 'none'
  const errorHint = fine
    ? 'Backspace to fix, or Alt/Ctrl+Backspace to erase a word.'
    : 'Delete to fix. Hold delete to erase a word.'
  let offset = 0
  return (
    <section class="typing" aria-label="Typing">
      <header class="typing-head">
        <div class="typing-meta">
          <span class="typing-topic">{round.passage.title}</span>
          <span class="typing-sentence">Sentence {index + 1} of {state.boundaries.length}</span>
        </div>
        <button type="button" class="ghost pause-btn" onClick={() => game.pause()} aria-label="Pause">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="5" y="4" width="5" height="16" rx="1.5" /><rect x="14" y="4" width="5" height="16" rx="1.5" /></svg>
          <span>Pause</span>
        </button>
      </header>
      <div class="typing-stats" aria-live="off">
        <span class="stat"><strong class="num">{metric(liveWpm)}</strong> WPM</span>
        <span class="stat"><strong class="num">{metric(m.accuracy, '%')}</strong> accuracy</span>
      </div>
      <div class="passage" data-testid="passage" onClick={() => { if (!paused) game.field.focus() }}>
        {words.map((word, w) => {
          const chars = word.split('').map((char, c) => {
            const i = offset + c
            let cls = 'todo'
            if (i < state.buffer.length) cls = i < target.length && char === target[i] ? 'ok' : 'bad'
            if (i === state.buffer.length) cls = state.error ? 'cursor cursor-error' : 'cursor'
            return <span key={i} class={`ch ${cls}`}>{char}</span>
          })
          offset += word.length
          return <span key={w} class="word">{chars}</span>
        })}
      </div>
      {state.error ? <p class="error-hint" role="status">! {errorHint}</p> : <p class="error-hint placeholder" aria-hidden="true">&nbsp;</p>}
      <div class="typing-spacer" />
      {!focused && !paused ? <button type="button" class="tap-to-type" onClick={() => game.field.focus()}>Tap to type</button> : null}
      <div class="progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
        <div class="progress-fill" style={{ width: `${progress}%` }} />
        <span class="progress-label">{progress}%</span>
      </div>
      <div class="hint typing-hint"><Kbd>Esc pause · F1 help</Kbd></div>
    </section>
  )
}

/** Split into words that carry their trailing space so wrapping never drops a scored space. */
export function splitWords(text: string): string[] {
  const words: string[] = []
  let current = ''
  for (const ch of text) {
    current += ch
    if (ch === ' ') {
      words.push(current)
      current = ''
    }
  }
  if (current) words.push(current)
  return words
}

export function PauseSheet({ game }: { game: Game }) {
  useKeys((e) => {
    if (e.key === 'Enter' || e.key === 'Escape') { game.resume(); return true }
    if (e.key.toLowerCase() === 'q') { game.leaveRound(); return true }
    if (e.key === '?' || e.key === 'F1') { game.openHelp(); return true }
    return false
  })
  return (
    <Sheet title="Paused" onClose={() => game.resume()}>
      <p class="sheet-copy">Take your time. The timer is stopped.</p>
      <div class="stack">
        <Button primary onClick={() => game.resume()}>Resume <Kbd>Enter</Kbd></Button>
        <Button onClick={() => game.openHelp()}>Help</Button>
        <Button onClick={() => game.leaveRound()}>Leave round <Kbd>Q</Kbd></Button>
      </div>
    </Sheet>
  )
}

/* ---------- Quiz ---------- */

export function Quiz({ game }: { game: Game }) {
  const round = game.round.value
  const quiz = game.quiz.value
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const select = (index: number) => {
    const current = game.quiz.value
    if (!current) return
    game.select(current.order[index])
    buttons.current[index]?.focus()
  }
  useKeys((e) => {
    const currentQuiz = game.quiz.value
    if (!currentQuiz) return false
    const key = e.key.toLowerCase()
    if (/^[1-4]$/.test(key) && Number(key) <= currentQuiz.order.length) { select(Number(key) - 1); return true }
    if (key === 'arrowdown' || key === 'arrowup' || key === 'arrowright' || key === 'arrowleft') {
      const focused = buttons.current.findIndex((button) => button === document.activeElement)
      const current = focused >= 0 ? focused : currentQuiz.order.indexOf(currentQuiz.selected ?? '')
      const forward = key === 'arrowdown' || key === 'arrowright'
      const next = current < 0
        ? (forward ? 0 : currentQuiz.order.length - 1)
        : (current + (forward ? 1 : -1) + currentQuiz.order.length) % currentQuiz.order.length
      select(next)
      return true
    }
    if (key === 'enter') { game.confirm(); return true }
    if (key === 's') { game.confirm(true); return true }
    if (key === 'escape') { game.leaveQuiz(); return true }
    if (key === '?') { game.openHelp(); return true }
    return false
  }, [quiz])
  if (!round || !quiz) return null
  const q = round.rec.question
  const opts = Object.fromEntries(q.options.map((o) => [o.id, o]))
  const label = { fresh: '', review: ' / Practice only', reassessment: ' / Reassessment' }[round.rec.evidenceKind]
  return (
    <Frame title="Question" back={() => game.leaveQuiz()} backLabel="Leave round"
      hint={<Kbd>1–{quiz.order.length} select · Enter confirm · S skip · Esc leave</Kbd>}
      bar={<>
        <Button onClick={() => game.confirm(true)}>Skip</Button>
        <Button primary disabled={!quiz.selected} onClick={() => game.confirm()}>Confirm</Button>
      </>}>
      <p class="level-tag">{LEVELS[q.level]}{label}</p>
      <p class="prompt">{q.prompt}</p>
      <div class="options" role="radiogroup" aria-label="Answers">
        {quiz.order.map((oid, i) => (
          <button key={oid} type="button" role="radio" aria-checked={quiz.selected === oid}
            ref={(button) => { buttons.current[i] = button }}
            class={`option ${quiz.selected === oid ? 'selected' : ''}`} onClick={() => game.select(oid)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.isComposing && !e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault()
                game.select(oid)
                game.confirm()
              }
            }}>
            <span class="option-number">{i + 1}</span>
            <span class="option-text">{opts[oid].text}</span>
          </button>
        ))}
      </div>
    </Frame>
  )
}

/* ---------- Results ---------- */

export function Results({ game }: { game: Game }) {
  const result = game.result.value
  useKeys((e) => {
    const key = e.key.toLowerCase()
    if (key === 'enter') { game.next(); return true }
    if (key === 'escape' || key === 'h') { game.home(); return true }
    if (key === '?') { game.overlay.value = 'details'; return true }
    return false
  })
  if (!result) return null
  const { metrics, question, outcome, state } = result
  const answer = question.options.find((o) => o.id === question.correct)!.text
  const title = outcome === 'correct' ? 'Correct!' : outcome === 'wrong' ? 'Not quite' : 'Skipped'
  return (
    <Frame title={title} hint={<Kbd>Enter next · Esc home · ? details</Kbd>}
      bar={<>
        <Button onClick={() => game.home()}>Home</Button>
        <Button onClick={() => { game.overlay.value = 'details' }}>Details</Button>
        <Button primary onClick={() => game.next()}>Next round</Button>
      </>}>
      <div class={`verdict verdict-${outcome}`} aria-hidden="true">
        {outcome === 'correct'
          ? <svg viewBox="0 0 24 24" class="check"><path d="M4 12.5l5 5L20 7" /></svg>
          : outcome === 'wrong' ? <span class="verdict-mark">✕</span> : <span class="verdict-mark">–</span>}
      </div>
      <div class="big-stats">
        <div class="big-stat"><span class="num pop">{metric(metrics.wpm)}</span><span class="unit">WPM</span></div>
        <div class="big-stat"><span class="num pop">{metric(metrics.accuracy, '%')}</span><span class="unit">accuracy</span></div>
      </div>
      <p class="level-tag">
        {LEVELS[state.level]} / Level {state.level}
        {result.levelChanged ? <span class="badge">{result.reason.startsWith('Level up') ? 'Level up!' : 'Reinforcing'}</span> : null}
      </p>
      <p class="answer"><strong>Answer:</strong> {answer}</p>
      <p class="explanation">{question.explanation}</p>
    </Frame>
  )
}

export function DetailsSheet({ game }: { game: Game }) {
  const result = game.result.value
  useKeys((e) => {
    if (e.key === 'Escape' || e.key === 'Enter') { game.closeOverlay(); return true }
    return false
  })
  if (!result) return null
  const refs = Object.fromEntries(game.content.data.sources.map((s) => [s.id, s]))
  const answer = result.question.options.find((o) => o.id === result.question.correct)!.text
  return (
    <Sheet title="Details" onClose={() => game.closeOverlay()}>
      <div class="prose scroll">
        <p><strong>{result.question.prompt}</strong></p>
        <p>Answer: {answer}</p>
        <p>{result.question.explanation}</p>
        <p class="passage-text">{result.passage.text}</p>
        <p><strong>Sources</strong></p>
        <ul>
          {result.passage.sources.map((s) => (
            <li key={s}><a href={refs[s].url} target="_blank" rel="noopener noreferrer">{refs[s].title}</a> — {refs[s].author}</li>
          ))}
        </ul>
      </div>
      <Button primary onClick={() => game.closeOverlay()}>Close</Button>
    </Sheet>
  )
}

/* ---------- Notebook ---------- */

export function Notebook({ game }: { game: Game }) {
  const topics = Object.keys(game.content.topics)
  const initial = game.topic.value ?? game.store.lastTopic() ?? topics[0]
  const [tid, setTid] = useState(topics.includes(initial) ? initial : topics[0])
  const [today, setToday] = useState(() => new Date().toDateString())
  const range = game.historyRange.value
  const filter = game.inputFilter.value
  const [, days] = HISTORY_RANGES[range]
  useEffect(() => {
    const timer = setTimeout(() => setToday(new Date().toDateString()), msUntilLocalMidnight())
    const visible = () => { if (!document.hidden) setToday(new Date().toDateString()) }
    document.addEventListener('visibilitychange', visible)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', visible) }
  }, [today])
  useKeys((e) => {
    const key = e.key.toLowerCase()
    if (key === 'escape') { game.navigate('home'); return true }
    if (key === 'arrowright') { game.setHistoryRange(range + 1); return true }
    if (key === 'arrowleft') { game.setHistoryRange(range - 1); return true }
    if (key === 't') { setTid(topics[(topics.indexOf(tid) + 1) % topics.length]); return true }
    if (key === 'enter') { game.topic.value = tid; game.navigate('rounds'); return true }
    if (key === '?') { game.openHelp(); return true }
    return false
  }, [range, tid])
  const { daily, understanding } = useMemo(() => ({
    daily: filteredDaily(game.store, tid, days, filter),
    understanding: game.store.understandingDaily(tid, days),
  }), [game.store.model, tid, days, filter, today])
  const dates = daily.map((r) => r[0])
  const latest = [...daily].reverse().find((r) => r[1] !== null)
  const level = [...understanding].reverse().find((r) => r[1] !== null)?.[1] ?? null
  return (
    <Frame title="Field notebook" wide back={() => game.navigate('home')}
      hint={<Kbd>← → range · T topic · Enter rounds · Esc home</Kbd>}
      bar={<Button primary onClick={() => { game.topic.value = tid; game.navigate('rounds') }}>Recent rounds</Button>}>
      <div class="segmented" role="tablist" aria-label="Topic">
        {topics.map((id) => (
          <button key={id} type="button" role="tab" aria-selected={id === tid} class={id === tid ? 'on' : ''} onClick={() => setTid(id)}>
            {game.content.topics[id].title}
          </button>
        ))}
      </div>
      <div class="segmented ranges" role="tablist" aria-label="Time range" style={{ '--count': HISTORY_RANGES.length, '--index': range }}>
        <span class="pill" aria-hidden="true" />
        {HISTORY_RANGES.map(([label], i) => (
          <button key={label} type="button" role="tab" aria-selected={i === range} class={i === range ? 'on' : ''} onClick={() => game.setHistoryRange(i)}>{label}</button>
        ))}
      </div>
      <LineChart title="TYPING" values={daily.map((r) => r[1])} dates={dates}
        summary={latest ? metric(latest[1], ' WPM') : 'No scores yet'} detail={latest ? `Latest day: ${latest[0]}` : ''}
        empty="Play a round to begin" />
      <StepChart title="UNDERSTANDING" values={understanding.map((r) => r[1])} dates={dates}
        summary={level !== null ? `Level ${level} of 4` : 'No assessments yet'} detail={level !== null ? LEVELS[level] : ''}
        empty="Answer a question to begin" />
      <div class="segmented small" role="tablist" aria-label="Typing device">
        {(['all', 'touch', 'keyboard'] as const).map((f) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} class={filter === f ? 'on' : ''} onClick={() => game.setInputFilter(f)}>
            {f === 'all' ? 'All devices' : f === 'touch' ? 'Phone' : 'Keyboard'}
          </button>
        ))}
      </div>
    </Frame>
  )
}

/** Daily medians restricted to one input method; the store's own bucketing rules apply. */
export function filteredDaily(store: Store, topic: string, days: number | null, filter: InputMethod | 'all') {
  if (filter === 'all') return store.daily(days, { topic })
  const keep = new Set(store.rounds({ topic }).filter((r) => r.metrics.input_method === filter).map((r) => r.id))
  const view = new Store({ ...store.model, rounds: store.model.rounds.filter((r) => keep.has(r.id)) }, store.clock)
  // All-time ranges still come from the unfiltered history so both charts share a timeline.
  const span = store.historyDays(topic, days)
  return view.daily(span, { topic })
}

/* ---------- Recent rounds ---------- */

export function Rounds({ game }: { game: Game }) {
  const topic = game.topic.value ?? game.store.lastTopic() ?? Object.keys(game.content.topics)[0]
  const rows = game.store.rounds({ topic, kind: 'practice' })
  useKeys((e) => {
    if (e.key === 'Escape' || e.key === 'Enter') { game.navigate('notebook'); return true }
    return false
  })
  return (
    <Frame title="Recent rounds" back={() => game.navigate('notebook')}
      bar={<Button primary onClick={() => game.navigate('notebook')}>Back <Kbd>Esc</Kbd></Button>}>
      <p class="muted">{game.content.topics[topic].title}</p>
      {rows.length ? (
        <table class="rounds">
          <thead><tr><th>Date</th><th>WPM</th><th>Accuracy</th><th>Question</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const m = r.metrics
              const scored = r.typing_status === 'complete' && !m.invalid && m.wpm !== null && m.wpm !== undefined
              let outcome = r.outcome ?? r.status
              if (scored && !Store.eligibleRounds([r]).length) outcome += ' (earlier typing rules)'
              return (
                <tr key={r.id}>
                  <td>{stamp(r.started)}</td>
                  <td class="num">{scored ? metric(m.wpm) : '--'}</td>
                  <td class="num">{metric(m.accuracy, '%')}</td>
                  <td>{outcome}{m.input_method ? <span class="tag">{m.input_method === 'touch' ? 'phone' : 'keys'}</span> : null}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : <p>No rounds yet.</p>}
    </Frame>
  )
}

/* ---------- Help ---------- */

export function Help({ game, asSheet }: { game: Game; asSheet: boolean }) {
  const fine = useFinePointer()
  useKeys((e) => {
    if (e.key === 'Escape' || e.key === 'Enter') { game.closeOverlay(); return true }
    return false
  })
  const body = (
    <div class="prose scroll">
      <p>Type the passage, then answer a question.</p>
      <p>The highlighted character is next. Spaces are ordinary spaces. Mistakes stay on screen until you delete them, so delete before retyping.</p>
      {fine
        ? <p>Backspace erases a character. Alt+Backspace or Ctrl+Backspace erases a word.</p>
        : <p>Delete erases a character. Hold delete to erase a word.</p>}
      <p>Type the space after each sentence to continue to the next one. Pressing space twice when a sentence's final period is next types the period for you (your phone's ". " shortcut counts too).</p>
      <p>{fine ? 'Esc pauses. F1 opens help.' : 'The pause button, closing the keyboard, or switching apps pauses.'} Pausing stops your typing timer.</p>
      <p><strong>WPM</strong> measures typing speed: correct characters ÷ 5 ÷ active minutes. <strong>Accuracy</strong> counts first tries.</p>
      <p>Question difficulty follows understanding, never typing speed. Immediate repeats are practice only; delayed reviews can count.</p>
      <p>Notebook: change the time range, switch topics, and filter by phone or keyboard so the two speeds don't mix.</p>
      <p>Progress saves automatically on this device. Use Data &amp; backup to export or move it.</p>
    </div>
  )
  if (asSheet) {
    return (
      <Sheet title="Help" onClose={() => game.closeOverlay()}>
        {body}
        <Button primary onClick={() => game.closeOverlay()}>Close <Kbd>Esc</Kbd></Button>
      </Sheet>
    )
  }
  return <Page title="Help" lines={body} onBack={() => game.closeOverlay()} />
}

/* ---------- Paste notice ---------- */

export function PasteNotice({ game }: { game: Game }) {
  useKeys((e) => {
    if (e.key === 'Escape' || e.key === 'Enter') { game.navigate('home'); return true }
    return false
  })
  return (
    <Page title="Paste detected" onBack={() => game.navigate('home')} back="Home"
      lines={<><p>This round will not be scored. Please type the passage.</p></>} />
  )
}

/* ---------- Data & backup ---------- */

export function Data({ game }: { game: Game }) {
  const [status, setStatus] = useState<StorageStatus>({ persisted: null, usage: null, quota: null })
  const [message, setMessage] = useState('')
  const refresh = () => { void storageStatus().then(setStatus) }
  useEffect(refresh, [])
  useKeys((e) => {
    if (e.key === 'Escape') { game.navigate('home'); return true }
    return false
  })
  const summary = game.store.summary()
  const total = game.store.model.rounds.length
  const exportCsv = async (which: 'rounds' | 'question-attempts') => {
    const text = which === 'rounds' ? roundsCsv(game.store.model) : questionAttemptsCsv(game.store.model)
    const how = await deliver([{ name: `metabotype-${which}-${exportStamp()}.csv`, text, type: 'text/csv' }], 'Metabotype history')
    if (how === 'canceled') { setMessage('Export canceled.'); return }
    setMessage(how === 'shared' ? `Shared ${which}.csv.` : `Downloaded ${which}.csv.`)
  }
  const backup = async () => {
    const how = await deliver([{ name: `metabotype-backup-${exportStamp()}.json`, text: JSON.stringify(makeBackup(game.store.model)), type: 'application/json' }], 'Metabotype backup')
    if (how === 'canceled') { setMessage('Backup canceled.'); return }
    game.store.setMeta({ last_backup: Date.now() / 1000 })
    setMessage(how === 'shared' ? 'Backup shared.' : 'Backup downloaded.')
  }
  const restore = async () => {
    if (game.round.value) { setMessage('Finish or leave the current round first.'); return }
    const file = await pickFile('application/json,.json')
    if (!file) return
    let model
    try {
      model = parseBackup(await file.text())
    } catch (error) {
      setMessage(`Could not read that file: ${(error as Error).message}`)
      return
    }
    const ok = window.confirm(`Replace all history on this device with the backup (${model.rounds.length} rounds)? Save a copy of the current history first to continue.`)
    if (!ok) return
    const how = await deliver([{ name: `metabotype-before-restore-${exportStamp()}.json`, text: JSON.stringify(makeBackup(game.store.model)), type: 'application/json' }], 'Metabotype backup')
    if (how === 'canceled') { setMessage('Restore canceled. Your history has not changed.'); return }
    if (game.readonly.value) return
    try {
      await game.restoreHistory(model)
    } catch (error) {
      setMessage(`Restore failed: ${(error as Error).message}`)
      return
    }
    location.reload()
  }
  const persist = async () => {
    const granted = await requestPersistence()
    setMessage(granted ? 'The browser will keep this history.' : 'The browser did not grant permanent storage; keep backups.')
    refresh()
  }
  const usage = status.usage !== null ? `${(status.usage / 1024).toFixed(0)} KB used` : ''
  return (
    <Frame title="Data & backup" back={() => game.navigate('home')}
      bar={<Button primary onClick={() => game.navigate('home')}>Home <Kbd>Esc</Kbd></Button>}>
      <div class="prose">
        <p><strong>{total}</strong> rounds on this device · best {metric(summary.best)} WPM · recent median {metric(summary.median)} WPM
          {summary.change !== null ? ` · change ${summary.change >= 0 ? '+' : ''}${summary.change.toFixed(1)}` : ''}</p>
        <p>History lives only in this browser. {status.persisted === true ? 'The browser has promised to keep it.' : status.persisted === false ? 'The browser may clear it if space runs low, so keep a backup.' : ''} {usage}</p>
        <div class="stack">
          {status.persisted !== true ? <Button onClick={persist}>Ask the browser to keep my history</Button> : null}
          <Button onClick={() => exportCsv('rounds')}>Export rounds (CSV)</Button>
          <Button onClick={() => exportCsv('question-attempts')}>Export question attempts (CSV)</Button>
          <Button onClick={backup}>Download backup (JSON)</Button>
          <Button onClick={restore}>Restore from backup…</Button>
        </div>
        {message ? <p class="notice" role="status">{message}</p> : null}
        <p class="muted">CSV columns match the terminal version's export, so old and new histories join on the same IDs.</p>
      </div>
    </Frame>
  )
}

/* ---------- Other tab ---------- */

export function OtherTab({ onUseHere, lost }: { onUseHere: () => void; lost: boolean }) {
  return (
    <Frame title="Open elsewhere" bar={
      lost ? <Button primary onClick={() => location.reload()}>Reload</Button> : <Button primary onClick={onUseHere}>Use it here</Button>
    }>
      <div class="prose">
        {lost
          ? <p>Another tab took over Metabotype, so this one stopped saving. Reload to continue here.</p>
          : <p>Metabotype is already open in another tab or window. Only one can save history at a time.</p>}
      </div>
    </Frame>
  )
}
