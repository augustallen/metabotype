/** The persisted history document. Mirrors the SQLite schema in cli/src/metabotype/storage.py. */
import type { TypingMetrics } from '../core/typing.ts'
import type { WindowEntry } from '../core/learning.ts'

export const SCHEMA_VERSION = 1

export interface Session { id: string; started: number; ended: number | null; app_version: string }

export type RoundStatus = 'typing' | 'quiz' | 'complete' | 'aborted' | 'interrupted'
export type TypingStatus = 'active' | 'partial' | 'complete'

export interface Round {
  id: string
  session_id: string
  topic: string
  concept: string
  passage_id: string
  passage_version: number
  started: number
  completed: number | null
  status: RoundStatus
  typing_status: TypingStatus
  kind: string
  repeated: number
  metrics: TypingMetrics | null
  reason: string
}

export type AttemptOutcome = 'pending' | 'correct' | 'wrong' | 'skipped' | 'unanswered'
export type EvidenceKind = 'fresh' | 'review' | 'reassessment'

export interface QuestionAttempt {
  round_id: string
  question_id: string
  question_version: number
  level: number
  option_order: string[]
  shown: number
  selected: string | null
  outcome: AttemptOutcome
  duration: number | null
  eligible: number
  evidence_kind: EvidenceKind
}

export interface LearningRow { topic: string; level: number; window: WindowEntry[]; wrong_streak: number; last_practiced: number }
export interface Review { concept: string; topic: string; stage: number; due: number }
export interface Transition {
  id: number; topic: string; previous_level: number; new_level: number; round_id: string
  reason: string; algorithm_version: number; created: number
}

export interface Meta {
  history_range?: number
  input_filter?: string
  last_backup?: number
  persist_prompted?: boolean
  install_hint_shown?: boolean
  [key: string]: unknown
}

export interface Model {
  schema_version: number
  sessions: Session[]
  rounds: Round[]
  questions: QuestionAttempt[]
  learning: Record<string, LearningRow>
  reviews: Record<string, Review>
  exposure: Record<string, number>
  transitions: Transition[]
  meta: Meta
}

export const ROUND_COLUMNS = ['id', 'session_id', 'topic', 'concept', 'passage_id', 'passage_version', 'started',
  'completed', 'status', 'typing_status', 'kind', 'repeated', 'metrics', 'reason'] as const
export const QUESTION_COLUMNS = ['round_id', 'question_id', 'question_version', 'level', 'option_order', 'shown',
  'selected', 'outcome', 'duration', 'eligible', 'evidence_kind'] as const

export function emptyModel(): Model {
  return {
    schema_version: SCHEMA_VERSION, sessions: [], rounds: [], questions: [], learning: {}, reviews: {},
    exposure: {}, transitions: [], meta: {},
  }
}

/** Validate before a document can replace history; errors identify the offending field. */
export function validateModel(value: unknown): Model {
  const fail = (path: string, why: string): never => { throw new Error(`Invalid history: ${path} ${why}`) }
  const record = (v: unknown, path: string): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return fail(path, 'must be an object')
    return v as Record<string, unknown>
  }
  const list = (v: unknown, path: string): unknown[] => {
    if (!Array.isArray(v)) return fail(path, 'must be a list')
    return v
  }
  const string = (v: unknown, path: string, nonempty = true): string => {
    if (typeof v !== 'string' || (nonempty && !v.length)) return fail(path, 'must be a string' + (nonempty ? ' with content' : ''))
    return v
  }
  const number = (v: unknown, path: string, min = 0, max = Number.MAX_VALUE): number => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) return fail(path, `must be a finite number from ${min} to ${max}`)
    return v
  }
  const integer = (v: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
    const n = number(v, path, min, max)
    if (!Number.isSafeInteger(n)) fail(path, 'must be an integer')
    return n
  }
  const timestamp = (v: unknown, path: string) => number(v, path, 0, 8.64e12)
  const boolean = (v: unknown, path: string) => { if (typeof v !== 'boolean') fail(path, 'must be a boolean') }
  const oneOf = (v: unknown, path: string, choices: readonly string[]) => {
    if (!choices.includes(string(v, path))) fail(path, `must be one of ${choices.join(', ')}`)
  }
  const unique = <T,>(set: Set<T>, id: T, path: string) => {
    if (set.has(id)) fail(path, 'is duplicated')
    set.add(id)
  }
  const fields = (row: Record<string, unknown>, path: string, keys: string[]) => {
    for (const key of keys) string(row[key], `${path}.${key}`)
  }
  const rows = (v: unknown, path: string) => list(v, path).map((row, i) => [record(row, `${path}[${i}]`), `${path}[${i}]`] as const)
  const entries = (v: unknown, path: string) => Object.entries(record(v, path)).map(([key, row]) => {
    string(key, path)
    // These dictionaries are later read and written through ordinary object properties.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') fail(`${path}.${key}`, 'is a reserved key')
    return [key, row, `${path}.${key}`] as const
  })

  const m = record(value, 'document')
  if (m.schema_version !== SCHEMA_VERSION) fail('schema_version', `is unsupported: ${String(m.schema_version)}`)
  const sessions = new Set<string>()
  for (const [s, path] of rows(m.sessions, 'sessions')) {
    fields(s, path, ['id', 'app_version'])
    unique(sessions, s.id as string, `${path}.id`)
    timestamp(s.started, `${path}.started`)
    if (s.ended !== null) timestamp(s.ended, `${path}.ended`)
  }

  const rounds = new Set<string>()
  for (const [r, path] of rows(m.rounds, 'rounds')) {
    fields(r, path, ['id', 'session_id', 'topic', 'concept', 'passage_id', 'kind'])
    string(r.reason, `${path}.reason`, false)
    unique(rounds, r.id as string, `${path}.id`)
    if (!sessions.has(r.session_id as string)) fail(`${path}.session_id`, 'references an unknown session')
    integer(r.passage_version, `${path}.passage_version`, 1)
    timestamp(r.started, `${path}.started`)
    if (r.completed !== null) timestamp(r.completed, `${path}.completed`)
    oneOf(r.status, `${path}.status`, ['typing', 'quiz', 'complete', 'aborted', 'interrupted'])
    oneOf(r.typing_status, `${path}.typing_status`, ['active', 'partial', 'complete'])
    integer(r.repeated, `${path}.repeated`, 0, 1)
    if (r.metrics !== null) {
      const pathM = `${path}.metrics`
      const metrics = record(r.metrics, pathM)
      integer(metrics.scoring_version, `${pathM}.scoring_version`, 1)
      string(metrics.typing_mode, `${pathM}.typing_mode`)
      boolean(metrics.invalid, `${pathM}.invalid`)
      if (metrics.wpm !== null) number(metrics.wpm, `${pathM}.wpm`)
      if (metrics.accuracy !== null) number(metrics.accuracy, `${pathM}.accuracy`, 0, 100)
      // Earlier scoring versions need not have counters introduced by editable sentences.
      for (const key of ['target_count', 'accepted_count', 'first_correct', 'attempted_count', 'incorrect_attempts',
        'correct_attempts', 'backspaces', 'word_deletions', 'deleted_characters', 'period_shortcuts', 'pending_attempts', 'best_combo']) {
        if (key in metrics) integer(metrics[key], `${pathM}.${key}`)
      }
      for (const key of ['active_duration', 'pause_duration']) {
        if (key in metrics) number(metrics[key], `${pathM}.${key}`)
      }
      for (const [key, v] of Object.entries(metrics)) {
        if (v !== null && typeof v !== 'string' && typeof v !== 'boolean' && (typeof v !== 'number' || !Number.isFinite(v))) {
          fail(`${pathM}.${key}`, 'must be a finite number, string, boolean or null')
        }
      }
    }
  }

  const questions = new Set<string>()
  for (const [q, path] of rows(m.questions, 'questions')) {
    fields(q, path, ['round_id', 'question_id'])
    if (!rounds.has(q.round_id as string)) fail(`${path}.round_id`, 'references an unknown round')
    unique(questions, q.round_id as string, `${path}.round_id`)
    integer(q.question_version, `${path}.question_version`, 1)
    integer(q.level, `${path}.level`, 1, 4)
    const options = new Set<string>()
    for (const [i, option] of list(q.option_order, `${path}.option_order`).entries()) {
      unique(options, string(option, `${path}.option_order[${i}]`), `${path}.option_order[${i}]`)
    }
    if (!options.size) fail(`${path}.option_order`, 'must contain options')
    timestamp(q.shown, `${path}.shown`)
    if (q.selected !== null && !options.has(string(q.selected, `${path}.selected`))) fail(`${path}.selected`, 'references an unknown option')
    oneOf(q.outcome, `${path}.outcome`, ['pending', 'correct', 'wrong', 'skipped', 'unanswered'])
    if (q.duration !== null) number(q.duration, `${path}.duration`)
    integer(q.eligible, `${path}.eligible`, 0, 1)
    oneOf(q.evidence_kind, `${path}.evidence_kind`, ['fresh', 'review', 'reassessment'])
  }

  for (const [key, value, path] of entries(m.learning, 'learning')) {
    const row = record(value, path)
    if (string(row.topic, `${path}.topic`) !== key) fail(`${path}.topic`, 'does not match its map key')
    integer(row.level, `${path}.level`, 1, 4)
    integer(row.wrong_streak, `${path}.wrong_streak`)
    timestamp(row.last_practiced, `${path}.last_practiced`)
    const window = list(row.window, `${path}.window`)
    const seen = new Set<string>()
    for (const [i, entry] of window.entries()) {
      const pathE = `${path}.window[${i}]`
      const pair = list(entry, pathE)
      if (pair.length !== 2) fail(pathE, 'must be a [question ID, correct] pair')
      unique(seen, string(pair[0], `${pathE}[0]`), `${pathE}[0]`)
      boolean(pair[1], `${pathE}[1]`)
    }
  }
  for (const [key, value, path] of entries(m.reviews, 'reviews')) {
    const row = record(value, path)
    if (string(row.concept, `${path}.concept`) !== key) fail(`${path}.concept`, 'does not match its map key')
    string(row.topic, `${path}.topic`)
    integer(row.stage, `${path}.stage`, 0, 3)
    timestamp(row.due, `${path}.due`)
  }
  for (const [, value, path] of entries(m.exposure, 'exposure')) timestamp(value, path)

  const transitions = new Set<number>()
  for (const [t, path] of rows(m.transitions, 'transitions')) {
    unique(transitions, integer(t.id, `${path}.id`, 1), `${path}.id`)
    fields(t, path, ['topic', 'round_id'])
    string(t.reason, `${path}.reason`, false)
    if (!rounds.has(t.round_id as string)) fail(`${path}.round_id`, 'references an unknown round')
    integer(t.previous_level, `${path}.previous_level`, 1, 4)
    integer(t.new_level, `${path}.new_level`, 1, 4)
    integer(t.algorithm_version, `${path}.algorithm_version`, 1)
    timestamp(t.created, `${path}.created`)
  }

  // A missing preferences object is compatible with older documents. A malformed one is not.
  const meta = m.meta === undefined ? {} : record(m.meta, 'meta')
  if ('history_range' in meta) integer(meta.history_range, 'meta.history_range')
  if ('input_filter' in meta) oneOf(meta.input_filter, 'meta.input_filter', ['all', 'touch', 'keyboard'])
  if ('last_backup' in meta) timestamp(meta.last_backup, 'meta.last_backup')
  for (const key of ['persist_prompted', 'install_hint_shown']) if (key in meta) boolean(meta[key], `meta.${key}`)
  return { ...m, meta } as unknown as Model
}
