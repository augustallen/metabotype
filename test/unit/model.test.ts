import { describe, expect, it } from 'vitest'
import { parseBackup, makeBackup } from '../../src/storage/backup.ts'
import { emptyModel, validateModel, type Model } from '../../src/storage/model.ts'
import { Store } from '../../src/storage/store.ts'
import { TypingState } from '../../src/core/typing.ts'
import { loadContent } from '../helpers.ts'

function history(): Model {
  const content = loadContent()
  const passage = content.passages['p-molecules']
  const question = content.questions['q-molecules-1']
  const store = new Store(null, () => 1789200000)
  store.startSession()
  const [rid] = store.beginRound(passage, 'test')
  let time = 0
  const typing = new TypingState(passage.text, () => time++)
  for (const char of passage.text) typing.feed(char)
  store.saveTyping(rid, typing.metrics(), passage, { complete: true })
  store.showQuestion(rid, question, question.options.map((o) => o.id), 'fresh')
  store.answer(rid, question, question.correct, 2)
  store.setMeta({ history_range: 0, input_filter: 'all', last_backup: 1789200000, persist_prompted: false })
  store.close()
  return store.model
}

// Deliberately assign unknown values at the deserialization boundary.
function set(model: Model, path: string, value: unknown): void {
  const parts = path.split('.')
  let target = model as unknown as Record<string, unknown>
  for (const part of parts.slice(0, -1)) target = target[part] as Record<string, unknown>
  target[parts.at(-1)!] = value
}

describe('history validation', () => {
  it('round-trips populated history and leaves it usable for practice and trends', () => {
    const model = history()
    const restored = parseBackup(JSON.stringify(makeBackup(model)))
    expect(restored).toEqual(model)
    const store = new Store(restored, () => 1789200000)
    expect(store.state('foundations').window).toHaveLength(1)
    expect(store.summary().count).toBe(1)
    expect(store.reviews()).toHaveLength(1)
    expect(store.understandingDaily('foundations')).toHaveLength(30)
  })

  it('accepts empty histories and missing legacy preferences without mutating the input', () => {
    expect(validateModel(emptyModel())).toEqual(emptyModel())
    const model = emptyModel() as Partial<Model>
    delete model.meta
    expect(validateModel(model).meta).toEqual({})
    expect(model).not.toHaveProperty('meta')
  })

  it('preserves earlier scoring metrics, arbitrary content IDs, and unknown preferences', () => {
    const model = history()
    const metrics = model.rounds[0].metrics! as Record<string, unknown>
    metrics.scoring_version = 1
    metrics.typing_mode = 'correction-required'
    delete metrics.word_deletions
    delete metrics.period_shortcuts
    model.rounds[0].passage_id = 'a-retired-passage'
    model.learning.foundations.window = [['a-retired-question', true]]
    model.meta.future_preference = { enabled: true }
    const restored = parseBackup(JSON.stringify(makeBackup(model)))
    expect(restored).toEqual(model)
    expect(new Store(restored).summary().count).toBe(0)
  })

  it.each([
    ['sessions.0', null],
    ['sessions.0.id', 3],
    ['sessions.0.started', 'yesterday'],
    ['sessions.0.ended', {}],
    ['rounds.0', null],
    ['rounds.0.session_id', 'missing'],
    ['rounds.0.passage_version', 0],
    ['rounds.0.status', 'finished'],
    ['rounds.0.typing_status', 'finished'],
    ['rounds.0.repeated', 2],
    ['rounds.0.metrics', []],
    ['rounds.0.metrics.accuracy', 101],
    ['rounds.0.metrics.wpm', -1],
    ['rounds.0.metrics.invalid', 'false'],
    ['rounds.0.metrics.accepted_count', 1.5],
    ['rounds.0.metrics.input_method', {}],
    ['questions.0', null],
    ['questions.0.round_id', 'missing'],
    ['questions.0.option_order', [null]],
    ['questions.0.option_order', ['a', 'a']],
    ['questions.0.selected', 'missing'],
    ['questions.0.outcome', 'great'],
    ['questions.0.duration', -1],
    ['questions.0.eligible', true],
    ['questions.0.evidence_kind', 'unknown'],
    ['learning.foundations', null],
    ['learning.foundations.window', null],
    ['learning.foundations.window', [[null, true]]],
    ['learning.foundations.window', [['q', 'yes']]],
    ['learning.foundations.window', [['q', true], ['q', false]]],
    ['learning.foundations.level', 5],
    ['learning.foundations.wrong_streak', -1],
    ['learning.foundations.topic', 'other-topic'],
    ['reviews.molecules', []],
    ['reviews.molecules.stage', 4],
    ['reviews.molecules.due', 'tomorrow'],
    ['reviews.molecules.concept', 'other-concept'],
    ['exposure.molecules', {}],
    ['transitions.0', null],
    ['transitions.0.round_id', 'missing'],
    ['transitions.0.new_level', 0],
    ['transitions.0.algorithm_version', 0],
    ['meta', []],
    ['meta', null],
    ['meta.history_range', 1.5],
    ['meta.input_filter', 'invalid'],
    ['meta.last_backup', -1],
    ['meta.persist_prompted', 1],
  ])('rejects malformed %s before returning an imported model', (path, value) => {
    const model = history()
    set(model, path, value)
    expect(() => parseBackup(JSON.stringify(makeBackup(model)))).toThrow('Invalid history:')
  })

  it.each(['sessions', 'rounds', 'questions', 'transitions'] as const)('rejects duplicate %s identities', (table) => {
    const model = history()
    ;(model[table] as unknown[]).push(structuredClone(model[table][0]))
    expect(() => validateModel(model)).toThrow('is duplicated')
  })

  it.each([NaN, Infinity, -Infinity, 8.64e12 + 1])('rejects invalid timestamps even outside JSON parsing (%s)', (value) => {
    const model = history()
    model.rounds[0].started = value
    expect(() => validateModel(model)).toThrow('rounds[0].started')
  })

  it('rejects reserved dictionary keys', () => {
    const model = emptyModel()
    model.exposure = JSON.parse('{"__proto__": 0}')
    expect(() => validateModel(model)).toThrow('reserved key')
  })
})
