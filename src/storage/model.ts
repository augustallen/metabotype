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

/** Structural check for loaded or imported documents; throws with a readable reason. */
export function validateModel(value: unknown): Model {
  const fail = (why: string): never => { throw new Error(`Invalid history: ${why}`) }
  if (!value || typeof value !== 'object') fail('not an object')
  const m = value as Record<string, unknown>
  if (m.schema_version !== SCHEMA_VERSION) fail(`unsupported schema version ${String(m.schema_version)}`)
  for (const key of ['sessions', 'rounds', 'questions', 'transitions']) {
    if (!Array.isArray(m[key])) fail(`${key} must be a list`)
  }
  for (const key of ['learning', 'reviews', 'exposure']) {
    if (!m[key] || typeof m[key] !== 'object' || Array.isArray(m[key])) fail(`${key} must be a map`)
  }
  const model = m as unknown as Model
  const sessions = new Set(model.sessions.map((s) => s.id))
  const rounds = new Set<string>()
  for (const r of model.rounds) {
    if (typeof r.id !== 'string' || typeof r.started !== 'number') fail('malformed round')
    if (!sessions.has(r.session_id)) fail(`round ${r.id} has an unknown session`)
    rounds.add(r.id)
  }
  for (const q of model.questions) {
    if (!rounds.has(q.round_id)) fail(`question attempt for unknown round ${q.round_id}`)
    if (!Array.isArray(q.option_order)) fail('malformed option order')
  }
  for (const t of model.transitions) {
    if (!rounds.has(t.round_id)) fail(`transition for unknown round ${t.round_id}`)
  }
  model.meta = model.meta && typeof model.meta === 'object' ? model.meta : {}
  return model
}
