import { beforeEach, describe, expect, it } from 'vitest'
import { DAY, newState, sameState } from '../../src/core/learning.ts'
import { TypingState } from '../../src/core/typing.ts'
import { recommend } from '../../src/core/practice.ts'
import { mulberry32 } from '../../src/core/rng.ts'
import { Store } from '../../src/storage/store.ts'
import { questionAttemptsCsv, roundsCsv } from '../../src/storage/export.ts'
import { makeBackup, parseBackup } from '../../src/storage/backup.ts'
import type { Passage } from '../../src/core/content.ts'
import { Clock, loadContent } from '../helpers.ts'

const content = loadContent()

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split('\r\n').filter(Boolean)
  const fields = lines[0].split(',')
  return lines.slice(1).map((line) => {
    const cells: string[] = []
    let current = ''
    let quoted = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { current += '"'; i++ }
        else if (ch === '"') quoted = false
        else current += ch
      } else if (ch === '"') quoted = true
      else if (ch === ',') { cells.push(current); current = '' }
      else current += ch
    }
    cells.push(current)
    return Object.fromEntries(fields.map((f, i) => [f, cells[i]]))
  })
}

describe('Store', () => {
  let clock: Clock
  let store: Store
  const p = content.passages['p-molecules']
  const q = content.questions['q-molecules-1']

  beforeEach(() => {
    clock = new Clock(1789200000)
    store = new Store(null, clock.tick)
    store.startSession()
  })

  function typed(passage: Passage = p, duration = 60): string {
    const [rid] = store.beginRound(passage, 'test')
    const timer = new Clock()
    const s = new TypingState(passage.text, timer.tick)
    s.feed(s.target[0])
    timer.advance(duration)
    for (const c of s.target.slice(1)) s.feed(c)
    store.saveTyping(rid, s.metrics(), passage, { complete: true })
    return rid
  }

  function transition(topic: string, level: number, created: number) {
    const passage = Object.values(content.passages).find((x) => x.topic === topic)!
    const rid = typed(passage)
    store.model.transitions.push({
      id: store.model.transitions.length + 1, topic, previous_level: 1, new_level: level, round_id: rid,
      reason: 'test', algorithm_version: 1, created,
    })
  }

  it('interrupted quiz preserves typing and exposure', () => {
    const rid = typed()
    store.showQuestion(rid, q, ['c', 'a', 'b'], 'fresh')
    store.close()
    store = new Store(store.model, clock.tick)
    expect(store.startSession()).toBe(1)
    const row = store.rounds()[0]
    expect(row.id).toBe(rid)
    expect(row.status).toBe('interrupted')
    expect(row.typing_status).toBe('complete')
    expect(row.outcome).toBe('unanswered')
    expect(store.summary().count).toBe(1)
    expect(store.encountered().has('molecules')).toBe(true)
    expect(sameState(store.state('foundations'), newState())).toBe(true)
  })

  it('checkpoint recovery is partial and unscored', () => {
    const [rid] = store.beginRound(p, 'test')
    const timer = new Clock()
    const s = new TypingState(p.text, timer.tick)
    for (const c of s.target.slice(0, 42)) {
      s.feed(c)
      timer.advance(0.1)
    }
    store.saveTyping(rid, s.metrics(), p)
    store.startSession()
    const row = store.rounds()[0]
    expect(row.metrics.accepted_count).toBe(42)
    expect(row.typing_status).toBe('partial')
    expect(store.summary().count).toBe(0)
    expect(store.encountered().has('molecules')).toBe(false)
  })

  it('answer is atomic and cannot apply twice', () => {
    const rid = typed()
    store.showQuestion(rid, q, ['b', 'a', 'c'], 'fresh')
    const { outcome } = store.answer(rid, q, 'a', 3)
    expect(outcome).toBe('correct')
    expect(store.state('foundations').window).toEqual([[q.id, true]])
    expect(store.reviews()[0].stage).toBe(1)
    expect(sameState(store.state('variation'), newState())).toBe(true)
    expect(() => store.answer(rid, q, 'a', 3)).toThrow()
    expect(store.model.transitions.length).toBe(1)
    expect(() => store.showQuestion(rid, q, ['a', 'b', 'c'], 'fresh')).toThrow()
    expect(() => store.answer(rid, q, 'zzz', 3)).toThrow(/Unknown answer option/)
  })

  it('a failed learning write rolls back the whole answer', () => {
    const rid = typed()
    store.showQuestion(rid, q, ['a', 'b', 'c'], 'fresh')
    const persisted: number[] = []
    store.persist = (m) => persisted.push(m.transitions.length)
    store.beforeWrite = (table) => { if (table === 'learning') throw new Error('test failure') }
    expect(() => store.answer(rid, q, 'a', 1)).toThrow('test failure')
    expect(store.model.questions[0].outcome).toBe('pending')
    expect(store.model.rounds[0].status).toBe('quiz')
    expect(Object.keys(store.model.reviews)).toEqual([])
    expect(store.model.transitions).toEqual([])
    expect(persisted).toEqual([])
  })

  it('old benchmark history is preserved but excluded from progress', () => {
    typed()
    const rid = typed()
    const row = store.model.rounds.find((r) => r.id === rid)!
    row.kind = 'benchmark'
    row.status = 'complete'
    expect(store.rounds()[0].repeated).toBe(1)
    expect(store.summary().count).toBe(1)
    expect(store.daily().reduce((n, d) => n + d[3], 0)).toBe(1)
    expect(store.rounds().length).toBe(2)
    expect(roundsCsv(store.model)).toContain('benchmark')
  })

  it('understanding trend tracks levels and keeps topics separate', () => {
    const now = clock.now
    transition('foundations', 1, now - 3 * DAY)
    transition('foundations', 2, now - 2 * DAY)
    transition('variation', 4, now - 2 * DAY)
    transition('foundations', 3, now - DAY)
    transition('foundations', 2, now - DAY + 1)
    const levels = store.understandingDaily('foundations').map((r) => r[1])
    expect(levels.length).toBe(30)
    expect(levels.slice(0, -4).every((v) => v === null)).toBe(true)
    expect(levels.slice(-4)).toEqual([1, 2, 2, 2])
    expect(store.understandingDaily('variation').at(-1)![1]).toBe(4)
    expect(store.state('foundations').level).toBe(1)
  })

  it('understanding seeds from before the window and ignores the future', () => {
    transition('foundations', 2, clock.now - 40 * DAY)
    transition('foundations', 4, clock.now + DAY)
    expect(store.understandingDaily('foundations').map((r) => r[1])).toEqual(Array(30).fill(2))
    expect(store.understandingDaily('variation').every((r) => r[1] === null)).toBe(true)
  })

  it('typing without a quiz does not create understanding points', () => {
    typed()
    expect(store.daily().at(-1)![1]).not.toBeNull()
    expect(store.understandingDaily('foundations').every((r) => r[1] === null)).toBe(true)
  })

  it('longer ranges include old rounds and align both timelines', () => {
    clock.advance(-500 * DAY)
    typed()
    transition('foundations', 2, clock.now)
    clock.advance(500 * DAY)
    typed()
    for (const days of [30, 90, 365]) {
      expect(store.daily(days, { topic: 'foundations' }).length).toBe(days)
      expect(store.understandingDaily('foundations', days).length).toBe(days)
    }
    const daily = store.daily(null, { topic: 'foundations' })
    const understanding = store.understandingDaily('foundations', null)
    expect(daily.length).toBe(501)
    expect(daily.map((r) => r[0])).toEqual(understanding.map((r) => r[0]))
    expect(daily[0][1]).not.toBeNull()
    expect(daily[1][1]).toBeNull()
    expect(daily.at(-1)![1]).not.toBeNull()
    expect(understanding.every((r) => r[1] === 2)).toBe(true)
    expect(store.historyDays('variation', null)).toBe(30)
  })

  it('all time uses topic history and has an empty fallback', () => {
    expect(store.daily(null).length).toBe(30)
    clock.advance(-100 * DAY)
    const passage = Object.values(content.passages).find((x) => x.topic === 'variation')!
    typed(passage)
    clock.advance(100 * DAY)
    typed()
    expect(store.historyDays('variation', null)).toBe(101)
    expect(store.historyDays('foundations', null)).toBe(1)
    expect(store.historyDays(null, null)).toBe(101)
    for (const days of [0, -1, 1.5]) expect(() => store.daily(days)).toThrow()
  })

  it('trends need two complete windows', () => {
    for (let i = 0; i < 19; i++) {
      typed()
      clock.advance(1)
    }
    expect(store.summary().change).toBeNull()
    typed(p, 30)
    expect(store.summary().change).toBe(0)
    const daily = store.daily()
    expect(daily.length).toBe(30)
    expect(daily.reduce((n, d) => n + d[3], 0)).toBe(20)
    expect(daily.some((d) => d[1] === null)).toBe(true)
  })

  it('incompatible scoring is excluded', () => {
    const rid = typed()
    store.model.rounds.find((r) => r.id === rid)!.metrics!.scoring_version = 99
    expect(store.summary().count).toBe(0)
  })

  it('local date buckets across midnight and DST', () => {
    const old = process.env.TZ
    try {
      process.env.TZ = 'America/Denver'
      // Both instants straddle local midnight on the spring DST change day.
      clock.now = Date.UTC(2026, 2, 8, 6, 59) / 1000
      typed()
      clock.advance(120)
      typed()
      const nonempty = store.daily().filter((row) => row[3])
      expect(nonempty.map((row) => [row[0], row[3]])).toEqual([['2026-03-07', 1], ['2026-03-08', 1]])
    } finally {
      if (old === undefined) delete process.env.TZ
      else process.env.TZ = old
    }
  })

  it('exports join and keep the CLI column layout', () => {
    const rid = typed()
    store.showQuestion(rid, q, ['c', 'a', 'b'], 'fresh')
    store.answer(rid, q, null, 5)
    const rows = parseCsv(roundsCsv(store.model))
    expect(rows[0].id).toBe(rid)
    expect(rows[0]).toHaveProperty('correct_attempts')
    expect(rows[0].invalid).toBe('False')
    expect(Object.keys(rows[0]).slice(0, 3)).toEqual(['id', 'session_id', 'topic'])
    const attempts = parseCsv(questionAttemptsCsv(store.model))
    expect(attempts[0].round_id).toBe(rid)
    expect(JSON.parse(attempts[0].option_order)).toEqual(['c', 'a', 'b'])
    expect(attempts[0].outcome).toBe('skipped')
    expect(attempts[0].selected).toBe('')
  })

  it('backups round-trip and reject foreign files', () => {
    const rid = typed()
    store.showQuestion(rid, q, ['a', 'b', 'c'], 'fresh')
    store.answer(rid, q, 'a', 2)
    const text = JSON.stringify(makeBackup(store.model))
    const restored = new Store(parseBackup(text), clock.tick)
    expect(restored.rounds()[0].id).toBe(rid)
    expect(restored.state('foundations').window.length).toBe(1)
    expect(() => parseBackup('{}')).toThrow(/Not a Metabotype backup/)
    expect(() => parseBackup('nope')).toThrow(/JSON/)
    const broken = makeBackup(store.model)
    broken.model.questions[0].round_id = 'missing'
    expect(() => parseBackup(JSON.stringify(broken))).toThrow(/unknown round/)
  })

  it('prerequisites and alternate question', () => {
    const first = recommend(content, store, { concept: 'molecules', rng: mulberry32(1) })
    expect(first.evidenceKind).toBe('fresh')
    expect(first.question.concept).toBe('molecules')
    expect(first.question.passages).toContain(first.passage.id)
    const rid = typed()
    store.showQuestion(rid, first.question, ['a', 'b', 'c'], 'fresh')
    store.answer(rid, first.question, 'b', 1)
    const second = recommend(content, store, { concept: 'molecules', rng: mulberry32(1) })
    expect(second.question.id).not.toBe(first.question.id)
    expect(second.review).toBe(true)
  })

  it('new players start on a random fresh round in the first topic', () => {
    const picks = new Set<string>()
    for (let seed = 1; seed <= 20; seed++) {
      const rec = recommend(content, store, { rng: mulberry32(seed) })
      expect(rec.question.topic).toBe('foundations')
      expect(rec.question.level).toBe(1)
      expect(rec.evidenceKind).toBe('fresh')
      picks.add(rec.passage.id)
    }
    expect(picks.size).toBeGreaterThan(1)
  })

  it('review round cap', () => {
    const first = recommend(content, store, { rng: mulberry32(1) })
    const concept = first.question.concept
    const rid = typed()
    store.showQuestion(rid, first.question, ['a', 'b', 'c'], 'fresh')
    store.answer(rid, first.question, 'b', 1)
    const review = recommend(content, store, { reviewStreak: 1 })
    expect(review.question.concept).toBe(concept)
    const newWork = recommend(content, store, { reviewStreak: 2 })
    expect(newWork.question.concept).not.toBe(concept)
  })

  it('exhausted bank and delayed reassessment', () => {
    for (const question of Object.values(content.questions)) {
      if (question.topic === 'foundations' && question.level === 1) {
        const rid = typed(content.passages[question.passages[0]])
        store.showQuestion(rid, question, ['a', 'b', 'c'], 'fresh')
        store.answer(rid, question, null, 1)
      }
    }
    expect(recommend(content, store, { topic: 'foundations' }).evidenceKind).toBe('review')
    clock.advance(DAY)
    expect(recommend(content, store, { topic: 'foundations' }).evidenceKind).toBe('reassessment')
  })

  it('no eligible lessons is an error', () => {
    expect(() => recommend(content, store, { concept: 'nonexistent' })).toThrow(/No eligible lessons/)
  })
})
