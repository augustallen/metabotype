/** Pure learning policy. Typing statistics never enter this module. Port of cli/src/metabotype/learning.py. */

export const ALGORITHM_VERSION = 1
export const WINDOW = 5
export const DAY = 86400
export const LEVELS: Record<number, string> = { 1: 'Recognize', 2: 'Explain', 3: 'Apply', 4: 'Evaluate' }

export type Outcome = 'correct' | 'wrong' | 'skipped'
export type WindowEntry = [string, boolean]

export interface LearningState {
  level: number
  window: WindowEntry[]
  wrong_streak: number
}

export function newState(level = 1, window: WindowEntry[] = [], wrongStreak = 0): LearningState {
  return { level, window: window.map((x) => [x[0], x[1]]), wrong_streak: wrongStreak }
}

export function sameState(a: LearningState, b: LearningState): boolean {
  return a.level === b.level && a.wrong_streak === b.wrong_streak
    && a.window.length === b.window.length
    && a.window.every((x, i) => x[0] === b.window[i][0] && x[1] === b.window[i][1])
}

export function update(state: LearningState, questionId: string, level: number, outcome: Outcome,
  eligible: boolean): [LearningState, string] {
  const result = newState(state.level, state.window, state.wrong_streak)
  if (!eligible || level !== state.level || outcome === 'skipped') {
    return [result, 'Review practice; difficulty unchanged.']
  }
  if (result.window.some((x) => x[0] === questionId)) {
    return [result, 'Repeated question; difficulty unchanged.']
  }
  const correct = outcome === 'correct'
  result.window = [...result.window, [questionId, correct] as WindowEntry].slice(-WINDOW)
  result.wrong_streak = correct ? 0 : result.wrong_streak + 1
  let reason = 'Answer recorded.'
  if (result.wrong_streak >= 2) {
    result.level = Math.max(1, result.level - 1)
    result.window = []
    result.wrong_streak = 0
    reason = 'Two misses: a little reinforcement before the next climb.'
  } else if (result.level < 4 && result.window.length === WINDOW
    && result.window.filter((x) => x[1]).length >= 4
    && result.window.slice(-2).every((x) => x[1])) {
    result.level++
    result.window = []
    result.wrong_streak = 0
    reason = 'Level up! Five distinct questions, four correct, last two correct.'
  }
  return [result, reason]
}

export interface ReviewRow {
  stage: number
  due: number
}

/** Stages: 0 immediate, 1 one-day check, 2 seven-day check, 3 settled. */
export function reviewAfter(previous: ReviewRow | null, outcome: Outcome, now: number,
  canClear: boolean): [number, number] | null {
  if (outcome !== 'correct') return [0, now]
  if (!canClear) return null
  if (previous === null || previous.stage === 0) return [1, now + DAY]
  if (previous.due > now || previous.stage === 3) return null
  if (previous.stage === 1) return [2, now + 7 * DAY]
  return [3, now]
}
