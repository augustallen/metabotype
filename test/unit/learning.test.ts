import { describe, expect, it } from 'vitest'
import { DAY, newState, reviewAfter, sameState, update, type LearningState, type Outcome } from '../../src/core/learning.ts'
import fixtures from '../fixtures/learning.json'

function sequence(outcomes: Outcome[], state: LearningState = newState()): LearningState {
  for (const [index, outcome] of outcomes.entries()) {
    ;[state] = update(state, String(index), state.level, outcome, true)
  }
  return state
}

const c: Outcome = 'correct'
const w: Outcome = 'wrong'

describe('learning policy', () => {
  it('promotion requires five distinct and latest two', () => {
    expect(sequence([c, c, c, c]).level).toBe(1)
    expect(sequence([c, w, c, c, c]).level).toBe(2)
    expect(sequence([c, c, c, c, w]).level).toBe(1)
    expect(sequence([c, c, c, c, w, c, c]).level).toBe(2)
  })

  it('demotion resets and floors', () => {
    const state = sequence([w, w], newState(3))
    expect([state.level, state.window, state.wrong_streak]).toEqual([2, [], 0])
    expect(sequence([w, w]).level).toBe(1)
  })

  it('promotion cannot cascade', () => {
    let state = sequence([c, c, c, c, c])
    expect(state.window).toEqual([])
    ;[state] = update(state, 'new', 2, 'correct', true)
    expect(state.level).toBe(2)
  })

  it('repeats, skips and other levels preserve the streak', () => {
    const state = sequence([w])
    for (const [eligible, level, outcome] of [[false, 1, c], [true, 1, 'skipped'], [true, 2, w]] as [boolean, number, Outcome][]) {
      const [next] = update(state, 'new', level, outcome, eligible)
      expect(sameState(next, state)).toBe(true)
    }
    const [repeated] = update(state, '0', 1, 'correct', true)
    expect(sameState(repeated, state)).toBe(true)
  })

  it('ceiling', () => {
    expect(sequence(Array(10).fill(c), newState(4)).level).toBe(4)
  })

  it('retention and early review', () => {
    expect(reviewAfter(null, 'correct', 0, true)).toEqual([1, DAY])
    expect(reviewAfter(null, 'wrong', 2, false)).toEqual([0, 2])
    expect(reviewAfter({ stage: 0, due: 0 }, 'correct', 3, false)).toBeNull()
    expect(reviewAfter({ stage: 1, due: DAY }, 'correct', 3, true)).toBeNull()
    expect(reviewAfter({ stage: 1, due: DAY }, 'correct', DAY, true)).toEqual([2, 8 * DAY])
    expect(reviewAfter({ stage: 2, due: 8 * DAY }, 'correct', 8 * DAY, true)).toEqual([3, 8 * DAY])
    expect(reviewAfter({ stage: 2, due: 8 * DAY }, 'skipped', 8 * DAY, true)).toEqual([0, 8 * DAY])
  })

  it('matches Python fixtures', () => {
    for (const { start, steps } of fixtures.updates) {
      let state = newState(start)
      for (const step of steps) {
        const [next, reason] = update(state, step.question, step.level, step.outcome as Outcome, step.eligible)
        expect({ level: next.level, window: next.window, wrong_streak: next.wrong_streak }).toEqual(step.state)
        expect(reason).toBe(step.reason)
        state = next
      }
    }
    for (const r of fixtures.reviews) {
      expect(reviewAfter(r.previous, r.outcome as Outcome, r.now, r.can_clear)).toEqual(r.result)
    }
  })
})
