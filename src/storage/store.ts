/**
 * Transactional local history over one in-memory document. Port of cli/src/metabotype/storage.py.
 *
 * Every mutation runs against a structural copy of the document and is swapped
 * in only when it finishes, so a failure part-way through changes nothing.
 * No keystroke traces are persisted.
 */
import { APP_VERSION } from '../version.ts'
import { ALGORITHM_VERSION, newState, reviewAfter, update, type LearningState, type Outcome } from '../core/learning.ts'
import { MODE, SCORING_VERSION, type TypingMetrics } from '../core/typing.ts'
import type { Passage, Question } from '../core/content.ts'
import { addDays, dateKey, dayNumber, localDate, median } from '../core/time.ts'
import { uuid } from '../core/rng.ts'
import { emptyModel, type EvidenceKind, type Model, type Review, type Round } from './model.ts'

export type Clock = () => number
export type Persist = (model: Model) => void

export interface RoundFilters { topic?: string | null; repeat?: boolean | null; kind?: string | null; days?: number | null }

export interface RoundView extends Omit<Round, 'metrics'> {
  metrics: Partial<TypingMetrics>
  question_id: string | null
  level: number | null
  outcome: string | null
}

export interface Summary { count: number; best: number | null; median: number | null; change: number | null }
export type DailyRow = [string, number | null, number | null, number]
export type LevelRow = [string, number | null]

export interface AnswerResult { outcome: Outcome; reason: string; state: LearningState }

export class Store {
  model: Model
  clock: Clock
  persist: Persist
  session: string | null = null
  /** Test hook: called before each table write inside a mutation. */
  beforeWrite: ((table: string) => void) | null = null

  constructor(model: Model | null = null, clock: Clock = () => Date.now() / 1000, persist: Persist = () => {}) {
    this.model = model ?? emptyModel()
    this.clock = clock
    this.persist = persist
  }

  private commit<T>(mutate: (draft: Model) => T): T {
    const draft = structuredClone(this.model)
    const result = mutate(draft)
    this.model = draft
    this.persist(draft)
    return result
  }

  private touch(table: string): void {
    if (this.beforeWrite) this.beforeWrite(table)
  }

  close(): void {
    if (this.session) {
      const id = this.session
      this.commit((m) => {
        const s = m.sessions.find((x) => x.id === id)
        if (s) s.ended = this.clock()
      })
    }
  }

  startSession(): number {
    const now = this.clock()
    return this.commit((m) => {
      let recovered = 0
      for (const r of m.rounds) {
        if (r.status === 'typing' || r.status === 'quiz') {
          recovered++
          r.status = 'interrupted'
          if (r.typing_status === 'active') r.typing_status = 'partial'
        }
      }
      for (const q of m.questions) if (q.outcome === 'pending') q.outcome = 'unanswered'
      for (const s of m.sessions) if (s.ended === null) s.ended = now
      this.session = uuid()
      m.sessions.push({ id: this.session, started: now, ended: null, app_version: APP_VERSION })
      return recovered
    })
  }

  state(topic: string): LearningState {
    const row = this.model.learning[topic]
    return row ? newState(row.level, row.window, row.wrong_streak) : newState()
  }

  encountered(): Set<string> {
    return new Set(Object.keys(this.model.exposure))
  }

  questionSeen(): Map<string, number> {
    const seen = new Map<string, number>()
    for (const q of this.model.questions) {
      const last = seen.get(q.question_id)
      if (last === undefined || q.shown > last) seen.set(q.question_id, q.shown)
    }
    return seen
  }

  reviews(dueOnly = false): Review[] {
    const now = this.clock()
    return Object.values(this.model.reviews)
      .filter((r) => r.stage < 3)
      .sort((a, b) => Number(b.stage === 0) - Number(a.stage === 0) || a.due - b.due)
      .filter((r) => !dueOnly || r.due <= now)
      .map((r) => ({ ...r }))
  }

  lastTopic(): string | null {
    let best: { topic: string; last_practiced: number } | null = null
    for (const row of Object.values(this.model.learning)) {
      if (!best || row.last_practiced > best.last_practiced) best = row
    }
    return best ? best.topic : null
  }

  beginRound(passage: Passage, reason: string): [string, boolean] {
    if (!this.session) throw new Error('Start a session first')
    const rid = uuid()
    const session = this.session
    return this.commit((m) => {
      const repeated = m.rounds.some((r) => r.passage_id === passage.id && r.typing_status === 'complete')
      this.touch('rounds')
      m.rounds.push({
        id: rid, session_id: session, topic: passage.topic, concept: passage.concepts[0],
        passage_id: passage.id, passage_version: passage.version, started: this.clock(), completed: null,
        status: 'typing', typing_status: 'active', kind: 'practice', repeated: repeated ? 1 : 0,
        metrics: null, reason,
      })
      return [rid, repeated]
    })
  }

  saveTyping(rid: string, metrics: TypingMetrics, passage: Passage,
    options: { complete?: boolean; aborted?: boolean } = {}): void {
    const complete = options.complete ?? false
    const aborted = options.aborted ?? false
    const typingStatus = complete ? 'complete' : aborted ? 'partial' : 'active'
    const status = aborted ? 'aborted' : complete ? 'quiz' : 'typing'
    const current = this.model.rounds.find((r) => r.id === rid)
    if (!current || current.status !== 'typing') return
    this.commit((m) => {
      const r = m.rounds.find((x) => x.id === rid)!
      this.touch('rounds')
      r.metrics = { ...metrics }
      r.typing_status = typingStatus
      r.status = status
      r.completed = complete ? this.clock() : null
      if (complete) {
        this.touch('exposure')
        for (const concept of passage.concepts) {
          if (!(concept in m.exposure)) m.exposure[concept] = this.clock()
        }
      }
    })
  }

  showQuestion(rid: string, question: Question, order: string[], evidenceKind: EvidenceKind): void {
    if (this.model.questions.some((q) => q.round_id === rid)) throw new Error('Question already shown for this round')
    this.commit((m) => {
      this.touch('questions')
      m.questions.push({
        round_id: rid, question_id: question.id, question_version: question.version, level: question.level,
        option_order: [...order], shown: this.clock(), selected: null, outcome: 'pending', duration: null,
        eligible: evidenceKind !== 'review' ? 1 : 0, evidence_kind: evidenceKind,
      })
    })
  }

  answer(rid: string, question: Question, selected: string | null, duration: number): AnswerResult {
    if (selected !== null && !question.options.some((o) => o.id === selected)) throw new Error('Unknown answer option')
    const outcome: Outcome = selected === null ? 'skipped' : selected === question.correct ? 'correct' : 'wrong'
    const now = this.clock()
    const saved = this.model.questions.find((q) => q.round_id === rid)
    if (!saved || saved.outcome !== 'pending') throw new Error('Question has already been answered or was never shown')
    if (saved.question_id !== question.id) throw new Error('Answer does not match presented question')
    const previous = this.state(question.topic)
    const [state, reason] = update(previous, question.id, question.level, outcome, Boolean(saved.eligible))
    this.commit((m) => {
      const q = m.questions.find((x) => x.round_id === rid)!
      this.touch('questions')
      q.selected = selected
      q.outcome = outcome
      q.duration = Math.max(0, duration)
      this.touch('learning')
      m.learning[question.topic] = {
        topic: question.topic, level: state.level, window: state.window.map((x) => [x[0], x[1]]),
        wrong_streak: state.wrong_streak, last_practiced: now,
      }
      const rev = m.reviews[question.concept]
      const change = reviewAfter(rev ? { stage: rev.stage, due: rev.due } : null, outcome, now, Boolean(saved.eligible))
      if (change) {
        this.touch('reviews')
        m.reviews[question.concept] = { concept: question.concept, topic: question.topic, stage: change[0], due: change[1] }
      }
      this.touch('transitions')
      const nextId = m.transitions.reduce((top, t) => Math.max(top, t.id), 0) + 1
      m.transitions.push({
        id: nextId, topic: question.topic, previous_level: previous.level, new_level: state.level,
        round_id: rid, reason, algorithm_version: ALGORITHM_VERSION, created: now,
      })
      this.touch('rounds')
      const r = m.rounds.find((x) => x.id === rid)
      if (r) r.status = 'complete'
    })
    return { outcome, reason, state }
  }

  abandonQuiz(rid: string): void {
    this.commit((m) => {
      const r = m.rounds.find((x) => x.id === rid)
      if (r && r.status === 'quiz') r.status = 'aborted'
      const q = m.questions.find((x) => x.round_id === rid)
      if (q && q.outcome === 'pending') q.outcome = 'unanswered'
    })
  }

  rounds(filters: RoundFilters = {}): RoundView[] {
    const { topic = null, repeat = null, kind = null, days = null } = filters
    const questions = new Map(this.model.questions.map((q) => [q.round_id, q]))
    const today = dayNumber(localDate(this.clock()))
    // Newest first; ties resolve to the later insertion, like SQLite's backward index scan.
    const rows = this.model.rounds.map((r, i) => [r, i] as const)
      .sort((a, b) => b[0].started - a[0].started || b[1] - a[1]).map((x) => x[0])
    const result: RoundView[] = []
    for (const row of rows) {
      if ((topic && row.topic !== topic) || (kind && row.kind !== kind)) continue
      if (repeat !== null && Boolean(row.repeated) !== repeat) continue
      if (days && dayNumber(localDate(row.started)) < today - (days - 1)) continue
      const q = questions.get(row.id)
      result.push({
        ...row, metrics: row.metrics ? { ...row.metrics } : {},
        question_id: q ? q.question_id : null, level: q ? q.level : null, outcome: q ? q.outcome : null,
      })
    }
    return result
  }

  static eligibleRounds(rows: RoundView[]): RoundView[] {
    return rows.filter((r) => r.typing_status === 'complete' && !r.metrics.invalid
      && r.metrics.scoring_version === SCORING_VERSION && r.metrics.typing_mode === MODE
      && r.metrics.wpm !== null && r.metrics.wpm !== undefined)
  }

  summary(filters: RoundFilters = {}): Summary {
    const rows = Store.eligibleRounds(this.rounds({ kind: 'practice', ...filters }))
    const speeds = rows.map((r) => r.metrics.wpm as number)
    return {
      count: rows.length,
      best: speeds.length ? Math.max(...speeds) : null,
      median: speeds.length ? median(speeds.slice(0, 10)) : null,
      change: speeds.length >= 20 ? median(speeds.slice(0, 10)) - median(speeds.slice(10, 20)) : null,
    }
  }

  /** Resolve a fixed range or all-time (null), shared by both graphs. */
  historyDays(topic: string | null, days: number | null): number {
    if (days !== null) {
      if (!Number.isInteger(days) || days < 1) throw new Error('History range must be a positive day count or null')
      return days
    }
    const now = this.clock()
    let first: number | null = null
    const consider = (stamp: number) => { if (first === null || stamp < first) first = stamp }
    for (const r of this.model.rounds) {
      if (r.kind === 'practice' && r.started <= now && (!topic || r.topic === topic)) consider(r.started)
    }
    const practice = new Set(this.model.rounds.filter((r) => r.kind === 'practice').map((r) => r.id))
    for (const t of this.model.transitions) {
      if (practice.has(t.round_id) && t.algorithm_version === ALGORITHM_VERSION && t.created <= now
        && (!topic || t.topic === topic)) consider(t.created)
    }
    if (first === null) return 30
    return dayNumber(localDate(now)) - dayNumber(localDate(first)) + 1
  }

  daily(days: number | null = 30, filters: RoundFilters = {}): DailyRow[] {
    const merged = { kind: 'practice', ...filters }
    const span = this.historyDays(merged.topic ?? null, days)
    const rows = Store.eligibleRounds(this.rounds(merged))
    const today = localDate(this.clock())
    const buckets = new Map<string, Partial<TypingMetrics>[]>()
    for (const r of rows) {
      const key = dateKey(localDate(r.started))
      const list = buckets.get(key) ?? []
      list.push(r.metrics)
      buckets.set(key, list)
    }
    const result: DailyRow[] = []
    for (let offset = span - 1; offset >= 0; offset--) {
      const key = dateKey(addDays(today, -offset))
      const values = buckets.get(key) ?? []
      result.push([
        key,
        values.length ? median(values.map((v) => v.wpm as number)) : null,
        values.length ? median(values.map((v) => v.accuracy as number)) : null,
        values.length,
      ])
    }
    return result
  }

  /**
   * End-of-day topic level, carried forward only after first assessment.
   * Uses the recorded transition time, not today's learning state or the
   * round start time; earlier history seeds the visible range.
   */
  understandingDaily(topic: string, days: number | null = 30): LevelRow[] {
    const today = localDate(this.clock())
    const span = this.historyDays(topic, days)
    const now = this.clock()
    const practice = new Set(this.model.rounds.filter((r) => r.kind === 'practice').map((r) => r.id))
    const events = this.model.transitions
      .filter((t) => t.topic === topic && t.algorithm_version === ALGORITHM_VERSION && practice.has(t.round_id) && t.created <= now)
      .sort((a, b) => a.created - b.created || a.id - b.id)
      .map((t) => [dayNumber(localDate(t.created)), t.new_level] as [number, number])
    let level: number | null = null
    let index = 0
    const result: LevelRow[] = []
    for (let offset = span - 1; offset >= 0; offset--) {
      const day = addDays(today, -offset)
      const number = dayNumber(day)
      while (index < events.length && events[index][0] <= number) {
        level = events[index][1]
        index++
      }
      result.push([dateKey(day), level])
    }
    return result
  }

  setMeta(patch: Partial<Model['meta']>): void {
    this.commit((m) => { Object.assign(m.meta, patch) })
  }
}
