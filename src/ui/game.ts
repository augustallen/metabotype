/** Round flow and app state as signals. Screens render from here; input flows in through the typing field. */
import { signal, type Signal } from '@preact/signals'
import type { Content, Passage, Question } from '../core/content.ts'
import type { LearningState, Outcome } from '../core/learning.ts'
import { recommend, type Recommendation } from '../core/practice.ts'
import { shuffle } from '../core/rng.ts'
import { TypingState, type TypingMetrics } from '../core/typing.ts'
import type { Store } from '../storage/store.ts'
import type { Model } from '../storage/model.ts'
import { requestPersistence } from '../storage/persist.ts'
import type { TypingField } from '../input/typing-field.ts'
import type { Reconciled } from '../input/reconcile.ts'

export type Screen = 'home' | 'topics' | 'typing' | 'quiz' | 'results' | 'notebook' | 'rounds' | 'help' | 'data'
  | 'paste' | 'other-tab'
export type Overlay = 'none' | 'pause' | 'help' | 'details'
export type InputMethod = 'touch' | 'keyboard'

export interface ActiveRound {
  rid: string
  passage: Passage
  rec: Recommendation
  typing: TypingState
  assisted: number
  multi: number
  normalized: number
  key229: boolean
}

export interface QuizState { order: string[]; selected: string | null; shownAt: number }

export interface RoundResult {
  metrics: TypingMetrics
  passage: Passage
  question: Question
  outcome: Outcome
  reason: string
  state: LearningState
  levelChanged: boolean
}

export const HISTORY_RANGES: [string, number | null][] = [['30 days', 30], ['90 days', 90], ['1 year', 365], ['All time', null]]

export const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

export class Game {
  screen: Signal<Screen> = signal('home')
  overlay: Signal<Overlay> = signal('none')
  notice: Signal<string> = signal('')
  topic: Signal<string | null> = signal(null)
  round: Signal<ActiveRound | null> = signal(null)
  quiz: Signal<QuizState | null> = signal(null)
  result: Signal<RoundResult | null> = signal(null)
  /** Bumped after every keystroke so the typing screen re-renders. */
  tick: Signal<number> = signal(0)
  historyRange: Signal<number> = signal(0)
  inputFilter: Signal<InputMethod | 'all'> = signal('all')
  saveError: Signal<string> = signal('')
  updateReady: Signal<(() => void) | null> = signal(null)
  readonly: Signal<boolean> = signal(false)
  reviewStreak = 0
  virtualKeyboardSeen = false
  private ticker: number | null = null
  private reader: Signal<'typing' | 'idle'> = signal('idle')

  constructor(readonly content: Content, readonly store: Store, readonly field: TypingField,
    readonly restoreHistory: (model: Model) => Promise<void>,
    readonly rng: () => number = Math.random) {
    const range = store.model.meta.history_range
    if (typeof range === 'number' && range >= 0 && range < HISTORY_RANGES.length) this.historyRange.value = range
    const filter = store.model.meta.input_filter
    if (filter === 'touch' || filter === 'keyboard' || filter === 'all') this.inputFilter.value = filter
  }

  get inputMethod(): InputMethod {
    return this.virtualKeyboardSeen || (this.round.value?.key229 ?? false) ? 'touch' : 'keyboard'
  }

  get deviceInput(): InputMethod {
    return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard'
  }

  navigate(screen: Screen): void {
    this.overlay.value = 'none'
    const swap = () => { this.screen.value = screen }
    const transition = (document as Document & { startViewTransition?: (cb: () => void | Promise<void>) => void }).startViewTransition
    if (transition && !reducedMotion() && screen !== 'typing') {
      transition.call(document, async () => {
        swap()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    } else {
      swap()
    }
  }

  /** Start a round synchronously so the field can be focused inside the tap. */
  play(topic: string | null = this.topic.value): boolean {
    if (this.readonly.value) return false
    let rec: Recommendation
    try {
      rec = recommend(this.content, this.store, { topic, reviewStreak: this.reviewStreak, rng: this.rng })
    } catch (error) {
      this.notice.value = (error as Error).message
      this.navigate('home')
      return false
    }
    const [rid] = this.store.beginRound(rec.passage, rec.reason)
    const typing = new TypingState(rec.passage.text)
    const round: ActiveRound = { rid, passage: rec.passage, rec, typing, assisted: 0, multi: 0, normalized: 0, key229: false }
    this.round.value = round
    this.quiz.value = null
    this.result.value = null
    this.notice.value = ''
    this.field.start({
      onKeys: (keys, stats) => this.feed(keys, stats),
      onPaste: () => this.pasteDetected(),
      onBlur: () => this.fieldBlurred(),
      onControl: (key) => this.control(key),
      onKey229: () => { round.key229 = true },
    }, () => this.mirror())
    this.screen.value = 'typing'
    this.overlay.value = 'none'
    this.field.focus()
    this.startTicker()
    return true
  }

  mirror(): string {
    const r = this.round.value
    return r ? r.typing.buffer + (r.typing.pendingPeriod ? ' ' : '') : ''
  }

  private metrics(round: ActiveRound): TypingMetrics {
    return {
      ...round.typing.metrics(),
      input_method: this.virtualKeyboardSeen || round.key229 ? 'touch' : 'keyboard',
      assisted_insertions: round.assisted,
      multi_char_insertions: round.multi,
      normalized_characters: round.normalized,
    }
  }

  feed(keys: string[], stats: Reconciled): void {
    const r = this.round.value
    if (!r || r.typing.complete || this.overlay.value !== 'none') return
    const before = r.typing.sentenceIndex
    for (const key of keys) r.typing.feed(key)
    r.assisted += stats.assisted
    r.multi += stats.multi
    r.normalized += stats.normalized
    this.tick.value++
    if (r.typing.complete) {
      const metrics = this.metrics(r)
      this.store.saveTyping(r.rid, metrics, r.passage, { complete: true })
      this.stopTicker()
      this.field.stop()
      this.field.blur()
      this.startQuiz(r, metrics)
    } else if (r.typing.sentenceIndex !== before) {
      this.store.saveTyping(r.rid, this.metrics(r), r.passage)
    }
  }

  private control(key: 'Escape' | 'F1' | 'Enter'): void {
    if (key === 'Escape') this.pause()
    if (key === 'F1') this.openHelp()
  }

  private fieldBlurred(): void {
    if (this.screen.value === 'typing' && this.overlay.value === 'none') this.pause()
  }

  /** Pause on anything that takes the keyboard away: Esc, a tap, the app going to the background. */
  pause(): void {
    const r = this.round.value
    if (!r || r.typing.complete || this.screen.value !== 'typing' || this.overlay.value !== 'none') return
    r.typing.pause()
    this.stopTicker()
    this.overlay.value = 'pause'
    this.field.blur()
  }

  checkpoint(): void {
    const r = this.round.value
    if (r && !r.typing.complete && this.screen.value === 'typing') this.store.saveTyping(r.rid, this.metrics(r), r.passage)
  }

  resume(): void {
    const r = this.round.value
    if (!r) return
    this.overlay.value = 'none'
    r.typing.resume()
    this.field.resync()
    this.field.focus()
    this.startTicker()
    this.tick.value++
  }

  leaveRound(): void {
    const r = this.round.value
    if (r) {
      r.typing.resume()
      this.store.saveTyping(r.rid, this.metrics(r), r.passage, { aborted: true })
    }
    this.clearRound()
    this.navigate('home')
  }

  pasteDetected(): void {
    const r = this.round.value
    if (!r || r.typing.complete) return
    r.typing.invalid = true
    r.typing.resume()
    this.store.saveTyping(r.rid, this.metrics(r), r.passage, { aborted: true })
    this.clearRound()
    this.navigate('paste')
  }

  private clearRound(): void {
    this.stopTicker()
    this.field.stop()
    this.field.blur()
    this.round.value = null
    this.quiz.value = null
  }

  openHelp(): void {
    const r = this.round.value
    if (this.screen.value === 'typing' && r && !r.typing.complete) {
      r.typing.pause()
      this.stopTicker()
      this.field.blur()
    }
    this.overlay.value = 'help'
  }

  closeOverlay(): void {
    const was = this.overlay.value
    this.overlay.value = 'none'
    if (was === 'help' && this.screen.value === 'typing' && this.round.value) this.overlay.value = 'pause'
  }

  private startQuiz(round: ActiveRound, metrics: TypingMetrics): void {
    const order = shuffle(round.rec.question.options.map((o) => o.id), this.rng)
    this.store.showQuestion(round.rid, round.rec.question, order, round.rec.evidenceKind)
    this.quiz.value = { order, selected: null, shownAt: performance.now() }
    this.result.value = { metrics, passage: round.passage, question: round.rec.question, outcome: 'skipped', reason: '', state: this.store.state(round.passage.topic), levelChanged: false }
    this.navigate('quiz')
  }

  select(optionId: string): void {
    const q = this.quiz.value
    if (q) this.quiz.value = { ...q, selected: optionId }
  }

  confirm(skip = false): void {
    const r = this.round.value
    const q = this.quiz.value
    const partial = this.result.value
    if (!r || !q || !partial) return
    if (!skip && !q.selected) return
    const previousLevel = this.store.state(r.passage.topic).level
    const duration = (performance.now() - q.shownAt) / 1000
    const answer = this.store.answer(r.rid, r.rec.question, skip ? null : q.selected, duration)
    this.reviewStreak = r.rec.review ? this.reviewStreak + 1 : 0
    this.result.value = {
      ...partial, outcome: answer.outcome, reason: answer.reason, state: answer.state,
      levelChanged: answer.state.level !== previousLevel,
    }
    this.round.value = null
    this.quiz.value = null
    this.navigate('results')
    if (!this.store.model.meta.persist_prompted) {
      this.store.setMeta({ persist_prompted: true })
      void requestPersistence()
    }
  }

  leaveQuiz(): void {
    const r = this.round.value
    if (r) this.store.abandonQuiz(r.rid)
    this.clearRound()
    this.navigate('home')
  }

  next(): void {
    this.play()
  }

  home(): void {
    this.navigate('home')
  }

  setHistoryRange(index: number): void {
    this.historyRange.value = (index + HISTORY_RANGES.length) % HISTORY_RANGES.length
    this.store.setMeta({ history_range: this.historyRange.value })
  }

  setInputFilter(filter: InputMethod | 'all'): void {
    this.inputFilter.value = filter
    this.store.setMeta({ input_filter: filter })
  }

  /** Another tab took over the history: stop writing and tell the player. */
  lost(): void {
    this.readonly.value = true
    this.store.persist = () => {}
    this.stopTicker()
    this.field.stop()
    this.round.value = null
    this.screen.value = 'other-tab'
    this.overlay.value = 'none'
  }

  private startTicker(): void {
    this.stopTicker()
    this.ticker = window.setInterval(() => { this.tick.value++ }, 500)
  }

  private stopTicker(): void {
    if (this.ticker !== null) {
      clearInterval(this.ticker)
      this.ticker = null
    }
  }
}
