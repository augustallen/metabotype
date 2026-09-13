import { describe, expect, it } from 'vitest'
import { TypingState } from '../../src/core/typing.ts'
import { Clock } from '../helpers.ts'
import fixtures from '../fixtures/typing.json'

function feedAll(s: TypingState, text: string) {
  for (const c of text) s.feed(c)
}

describe('TypingState', () => {
  it('corrections and first-attempt accuracy', () => {
    const clock = new Clock()
    const s = new TypingState('ab c', clock.tick)
    s.feed('x')
    clock.advance(1)
    s.feed('\b')
    s.feed('y')
    s.feed('\b')
    s.feed('a')
    clock.advance(1)
    s.feed('b')
    s.feed(' ')
    clock.advance(2)
    s.feed('c')
    const m = s.metrics()
    expect([m.attempted_count, m.first_correct]).toEqual([4, 3])
    expect([m.incorrect_attempts, m.correct_attempts, m.backspaces]).toEqual([2, 4, 2])
    expect(m.accuracy).toBe(75)
    expect(m.wpm).toBe(12)
    expect(s.complete).toBe(true)
    clock.advance(100)
    expect(s.metrics().wpm).toBe(12)
  })

  it('pauses exclude only paused time', () => {
    const clock = new Clock()
    const s = new TypingState('ab', clock.tick)
    s.pause()
    clock.advance(100)
    s.resume()
    s.feed('a')
    clock.advance(1)
    s.pause()
    s.pause()
    clock.advance(60)
    s.feed('b')
    expect(s.complete).toBe(false)
    expect(s.metrics().active_duration).toBe(1)
    s.resume()
    clock.advance(1)
    s.feed('b')
    expect(s.metrics().active_duration).toBe(2)
    expect(s.metrics().pause_duration).toBe(60)
  })

  it('zero time and empty sample', () => {
    const s = new TypingState('a', new Clock().tick)
    expect(s.metrics().accuracy).toBeNull()
    s.feed('a')
    expect(s.metrics().wpm).toBeNull()
  })

  it('backspace removes correct text without double counting', () => {
    const clock = new Clock()
    const s = new TypingState('abc', clock.tick)
    s.feed('a')
    s.feed('b')
    s.feed('\b')
    expect(s.position).toBe(1)
    clock.advance(1)
    s.feed('b')
    s.feed('c')
    expect(s.complete).toBe(true)
    expect(s.metrics().accepted_count).toBe(3)
    expect(s.metrics().correct_attempts).toBe(4)
    expect(s.metrics().accuracy).toBe(100)
    expect(s.metrics().wpm).toBe(36)
  })

  it('sentence requires separator spaces and counts them', () => {
    const s = new TypingState('Hi.  Bye? Yes!')
    feedAll(s, 'Hi.')
    expect(s.sentence()).toEqual([0, 0, 5])
    expect(s.position).toBe(3)
    s.feed(' ')
    expect(s.sentenceIndex).toBe(0)
    s.feed(' ')
    expect(s.sentence()).toEqual([1, 5, 10])
    expect(s.metrics().target_count).toBe(14)
    s.feed('\b')
    s.feed('WORD_BACKSPACE')
    expect(s.position).toBe(5) // Finished sentences stay locked.
    feedAll(s, 'Bye? Yes!')
    expect(s.complete).toBe(true)
    expect(s.metrics().accepted_count).toBe(14)
    expect(s.metrics().correct_attempts).toBe(14)
    expect(s.metrics().accuracy).toBe(100)
  })

  it('mistakes cannot be overwritten with the correct key', () => {
    const s = new TypingState('abc')
    s.feed('x')
    s.feed('a')
    expect(s.buffer).toBe('xa')
    expect(s.position).toBe(0)
    s.feed('\b')
    expect(s.buffer).toBe('x')
    s.feed('\b')
    feedAll(s, 'abc')
    expect(s.complete).toBe(true)
    expect(s.metrics().accuracy).toBeCloseTo(100 / 3)
    expect(s.metrics().incorrect_attempts).toBe(2)
  })

  it('double space enters period and separator', () => {
    const clock = new Clock()
    const s = new TypingState('Hi. Bye.', clock.tick)
    feedAll(s, 'Hi')
    s.feed(' ')
    expect(s.sentenceIndex).toBe(0)
    expect(s.position).toBe(2)
    expect(s.metrics().pending_attempts).toBe(1)
    clock.advance(1)
    s.feed(' ')
    expect(s.sentenceIndex).toBe(1)
    expect(s.position).toBe(4)
    feedAll(s, 'Bye  ')
    expect(s.complete).toBe(true)
    const m = s.metrics()
    expect(m.accepted_count).toBe(8)
    expect(m.correct_attempts).toBe(9)
    expect(m.period_shortcuts).toBe(2)
    expect(m.accuracy).toBe(100)
    expect(m.incorrect_attempts).toBe(0)
    expect(m.wpm).toBe(96)
  })

  it('double space does not replace other punctuation or fix errors', () => {
    for (const [target, text] of [['Hi? Bye.', 'Hi  '], ['Hi. Bye.', 'Hx  '], ['Hi  there.', 'Hi  ']]) {
      const s = new TypingState(target)
      feedAll(s, text)
      expect(s.metrics().period_shortcuts).toBe(0)
      expect(s.buffer).toBe(text)
    }
  })

  it('incomplete shortcut is literal input and requires deletion', () => {
    const s = new TypingState('Hi.')
    feedAll(s, 'Hi x')
    expect(s.buffer).toBe('Hi x')
    expect(s.metrics().incorrect_attempts).toBe(2)
    s.feed('BACKSPACE')
    s.feed('BACKSPACE')
    s.feed('.')
    expect(s.complete).toBe(true)
    expect(s.metrics().accuracy).toBeCloseTo(200 / 3)
  })

  it('word delete cancels pending shortcut and pause preserves it', () => {
    const s = new TypingState('Hi.')
    feedAll(s, 'Hi ')
    s.pause()
    s.feed(' ')
    expect(s.pendingPeriod).toBe(true)
    s.resume()
    s.feed('WORD_BACKSPACE')
    expect(s.pendingPeriod).toBe(false)
    expect(s.buffer).toBe('')
    expect(s.metrics().deleted_characters).toBe(3)
  })

  it('word delete rewinds to start and preserves first-attempt errors', () => {
    const s = new TypingState('alpha beta gamma.')
    feedAll(s, 'alpha bexa')
    expect(s.error).toBeTruthy()
    s.feed('WORD_BACKSPACE')
    expect(s.buffer).toBe('alpha ')
    expect(s.error).toBe('')
    feedAll(s, 'beta gamma.')
    expect(s.complete).toBe(true)
    const m = s.metrics()
    expect(m.word_deletions).toBe(1)
    expect(m.deleted_characters).toBe(4)
    expect(m.first_correct).toBe(s.target.length - 1)
    expect(m.correct_attempts).toBeGreaterThan(m.accepted_count)
  })

  it('word delete with trailing spaces, empty buffer, and pause', () => {
    const s = new TypingState('one two three.')
    feedAll(s, 'one two ')
    s.feed('\x17')
    expect(s.buffer).toBe('one ')
    s.feed('WORD_BACKSPACE')
    s.feed('WORD_BACKSPACE')
    expect(s.buffer).toBe('')
    s.feed('o')
    s.pause()
    s.feed('WORD_BACKSPACE')
    expect(s.buffer).toBe('o')
  })

  it('wrong sentence cannot advance and overflow must be deleted', () => {
    const s = new TypingState('Hi. Bye.')
    feedAll(s, 'Hx.extra')
    expect(s.sentenceIndex).toBe(0)
    s.feed('WORD_BACKSPACE')
    feedAll(s, 'Hi. ')
    expect(s.sentenceIndex).toBe(1)
    expect(s.firstCorrect).toBeLessThanOrEqual(s.attempted)
  })

  it('non-text ignored and invalid paste unscored', () => {
    const clock = new Clock()
    const s = new TypingState('ab', clock.tick)
    s.feed('ENTER')
    expect(s.attempted).toBe(0)
    s.feed('a')
    s.invalid = true
    clock.advance(1)
    s.feed('b')
    expect(s.metrics().wpm).toBeNull()
  })

  it('rejects non-ASCII or empty targets', () => {
    expect(() => new TypingState('')).toThrow()
    expect(() => new TypingState('café')).toThrow()
    expect(() => new TypingState('tab\there')).toThrow()
  })
})

describe('Python parity fixtures', () => {
  type Step = [string, number, string, number, number, number, number, number, number, number, number, number, number, number]
  const cases = fixtures as { target: string; steps: Step[]; final: Record<string, number | string | boolean | null>; complete: boolean }[]

  it(`replays ${cases.length} recorded sessions identically`, () => {
    let checked = 0
    for (const [n, c] of cases.entries()) {
      const now = { value: 0 }
      const s = new TypingState(c.target, () => now.value)
      for (const [i, step] of c.steps.entries()) {
        const [key, t, buffer, position, sentence, pending, attempted, firstCorrect, incorrect, correct,
          backspaces, wordDeletions, deleted, shortcuts] = step
        // The Python script advanced its clock only after feeding a key; pauses and ticks happen at the old time.
        if (key === 'PAUSE') s.pause()
        else if (key === 'RESUME') s.resume()
        else if (key !== 'TICK') s.feed(key)
        now.value = t
        const m = s.metrics()
        const actual = [s.buffer, s.position, s.sentenceIndex, s.pendingPeriod ? 1 : 0, m.attempted_count,
          m.first_correct, m.incorrect_attempts, m.correct_attempts, m.backspaces, m.word_deletions,
          m.deleted_characters, m.period_shortcuts]
        const recorded = [buffer, position, sentence, pending, attempted, firstCorrect, incorrect, correct,
          backspaces, wordDeletions, deleted, shortcuts]
        // Compare cheaply; only build an assertion message on a mismatch.
        if (actual.some((v, k) => v !== recorded[k])) {
          expect(actual, `case ${n} step ${i} key ${JSON.stringify(key)}`).toEqual(recorded)
        }
        checked++
      }
      s.resume()
      expect(s.complete, `case ${n} completion`).toBe(c.complete)
      const final = s.metrics()
      for (const [key, value] of Object.entries(c.final)) {
        if (typeof value === 'number' && typeof final[key] === 'number') expect(final[key], `case ${n} final ${key}`).toBeCloseTo(value, 9)
        else expect(final[key], `case ${n} final ${key}`).toEqual(value)
      }
    }
    expect(checked).toBeGreaterThan(10000)
  }, 60000)
})
