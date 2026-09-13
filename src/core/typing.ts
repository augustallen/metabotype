/** Editable sentence typing, independent of input devices and rendering. Port of cli/src/metabotype/typing.py. */

export const SCORING_VERSION = 3
export const MODE = 'editable-sentences'

export type Clock = () => number

export const defaultClock: Clock = () => performance.now() / 1000

const DELETIONS = new Set(['\b', '\x7f', 'BACKSPACE', 'WORD_BACKSPACE', '\x17'])
const WORD_DELETIONS = new Set(['WORD_BACKSPACE', '\x17'])
const NOT_PRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u

/** Mirrors Python's str.isprintable() for one character; space is printable. */
export function isPrintable(key: string): boolean {
  return key.length === 1 && (key === ' ' || !NOT_PRINTABLE.test(key))
}

export interface TypingMetrics {
  active_duration: number
  target_count: number
  accepted_count: number
  first_correct: number
  attempted_count: number
  incorrect_attempts: number
  correct_attempts: number
  backspaces: number
  word_deletions: number
  deleted_characters: number
  period_shortcuts: number
  pending_attempts: number
  pause_duration: number
  best_combo: number
  wpm: number | null
  accuracy: number | null
  scoring_version: number
  typing_mode: string
  invalid: boolean
  [extra: string]: number | string | boolean | null
}

export class TypingState {
  readonly target: string
  readonly clock: Clock
  /** Each boundary is the index just past the sentence's separator space(s). */
  readonly boundaries: number[] = []
  sentenceIndex = 0
  buffer = ''
  pendingPeriod = false
  periodShortcuts = 0
  firstAttempts = new Map<number, boolean>()
  attempted = 0
  firstCorrect = 0
  incorrect = 0
  correct = 0
  backspaces = 0
  wordDeletions = 0
  deletedCharacters = 0
  combo = 0
  bestCombo = 0
  started: number | null = null
  finished: number | null = null
  pauseStarted: number | null = null
  pauseSeconds = 0
  invalid = false

  constructor(target: string, clock: Clock = defaultClock) {
    if (!target || [...target].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126)) {
      throw new Error('Target must be nonempty printable ASCII')
    }
    this.target = target
    this.clock = clock
    for (const m of target.matchAll(/[.!?] +/g)) this.boundaries.push(m.index + m[0].length)
    if (!this.boundaries.length || this.boundaries[this.boundaries.length - 1] !== target.length) {
      this.boundaries.push(target.length)
    }
  }

  get complete(): boolean {
    return this.finished !== null
  }

  /** Correct prefix only: deleting and retyping never adds WPM credit. */
  get position(): number {
    const [, start, end] = this.sentence()
    const expected = this.target.slice(start, end)
    let count = 0
    const limit = Math.min(this.buffer.length, expected.length)
    for (let i = 0; i < limit; i++) {
      if (this.buffer[i] !== expected[i]) break
      count++
    }
    return start + count
  }

  get error(): string {
    const [, start] = this.sentence()
    const prefix = this.position - start
    return prefix < this.buffer.length ? this.buffer.slice(prefix) : ''
  }

  sentence(): [number, number, number] {
    const index = this.sentenceIndex
    const start = index ? this.boundaries[index - 1] : 0
    return [index, start, this.boundaries[index]]
  }

  pause(): void {
    if (this.pauseStarted === null) this.pauseStarted = this.clock()
  }

  resume(): void {
    if (this.pauseStarted !== null) {
      if (this.started !== null) this.pauseSeconds += this.clock() - this.pauseStarted
      this.pauseStarted = null
    }
  }

  feed(key: string): void {
    if (this.complete || this.pauseStarted !== null) return
    const deletion = DELETIONS.has(key)
    const printable = isPrintable(key)
    if (this.pendingPeriod) {
      if (key === ' ') {
        this.pendingPeriod = false
        this.periodShortcuts++
        this.appendPrintable('.')
        if (!this.complete) {
          this.appendPrintable(' ')
        } else {
          // Two physical keys produced the final period; no extra WPM credit.
          this.correct++
        }
        return
      }
      if (!(deletion || printable)) return
      // A single space followed by another key is ordinary input, not a shortcut.
      this.pendingPeriod = false
      this.appendPrintable(' ')
    }
    if (deletion) {
      const before = this.buffer.length
      if (WORD_DELETIONS.has(key)) {
        this.wordDeletions++
        this.buffer = this.buffer.replace(/ +$/, '')
        this.buffer = this.buffer.slice(0, this.buffer.lastIndexOf(' ') + 1)
      } else {
        this.backspaces++
        this.buffer = this.buffer.slice(0, -1)
      }
      this.deletedCharacters += before - this.buffer.length
      this.combo = 0
      return
    }
    if (!printable) return
    if (this.started === null) this.started = this.clock()
    const [, start, end] = this.sentence()
    const cursor = start + this.buffer.length
    if (key === ' ' && !this.error && this.target.slice(cursor, end).replace(/ +$/, '') === '.') {
      this.pendingPeriod = true
      return
    }
    this.appendPrintable(key)
  }

  private appendPrintable(key: string): void {
    const [, start, end] = this.sentence()
    const cursor = start + this.buffer.length
    const correct = cursor < end && key === this.target[cursor]
    if (cursor < end && !this.firstAttempts.has(cursor)) {
      this.firstAttempts.set(cursor, correct)
      this.attempted++
      this.firstCorrect += correct ? 1 : 0
    }
    this.buffer += key
    if (correct) {
      this.correct++
      this.combo++
      this.bestCombo = Math.max(this.bestCombo, this.combo)
    } else {
      this.incorrect++
      this.combo = 0
    }
    if (this.buffer === this.target.slice(start, end)) {
      if (this.sentenceIndex === this.boundaries.length - 1) {
        this.finished = this.clock()
      } else {
        this.sentenceIndex++
        this.buffer = ''
      }
    }
  }

  metrics(): TypingMetrics {
    const end = this.finished !== null ? this.finished : this.clock()
    let pause = this.pauseSeconds
    if (this.pauseStarted !== null && this.started !== null) pause += end - this.pauseStarted
    const duration = this.started !== null ? Math.max(0, end - this.started - pause) : 0
    const accepted = this.position
    return {
      active_duration: duration,
      target_count: this.target.length,
      accepted_count: accepted,
      first_correct: this.firstCorrect,
      attempted_count: this.attempted,
      incorrect_attempts: this.incorrect,
      correct_attempts: this.correct,
      backspaces: this.backspaces,
      word_deletions: this.wordDeletions,
      deleted_characters: this.deletedCharacters,
      period_shortcuts: this.periodShortcuts,
      pending_attempts: this.pendingPeriod ? 1 : 0,
      pause_duration: pause,
      best_combo: this.bestCombo,
      wpm: duration > 0 && !this.invalid ? (accepted * 12) / duration : null,
      accuracy: this.attempted ? (100 * this.firstCorrect) / this.attempted : null,
      scoring_version: SCORING_VERSION,
      typing_mode: MODE,
      invalid: this.invalid,
    }
  }
}
