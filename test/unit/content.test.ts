import { describe, expect, it } from 'vitest'
import { Content, ContentError } from '../../src/core/content.ts'
import { TypingState } from '../../src/core/typing.ts'
import { loadContent } from '../helpers.ts'

describe('content', () => {
  it('bundled curriculum', () => {
    const c = loadContent()
    expect([Object.keys(c.topics).length, Object.keys(c.passages).length, Object.keys(c.questions).length]).toEqual([2, 10, 80])
  })

  it('duplicate and missing option rejected', () => {
    const c = loadContent()
    const original = structuredClone(c.data)
    c.data.questions[1].id = c.data.questions[0].id
    expect(() => c.validate()).toThrow(ContentError)
    c.data = original
    c.data.questions[0].correct = 'missing'
    expect(() => c.validate()).toThrow(ContentError)
  })

  it('unreachable prerequisites rejected', () => {
    const c = loadContent()
    for (const p of c.data.passages) p.prerequisites = ['molecules']
    expect(() => c.validate()).toThrow(ContentError)
  })

  it('malformed content is a ContentError', () => {
    expect(() => new Content({ version: 1 })).toThrow(ContentError)
    expect(() => new Content({ version: 2, topics: [], passages: [], questions: [], sources: [] })).toThrow(/Unsupported/)
  })

  it('every passage splits into exactly five sentences of typeable ASCII', () => {
    for (const passage of Object.values(loadContent().passages)) {
      const state = new TypingState(passage.text)
      expect(state.boundaries.length).toBe(5)
      expect(state.boundaries[state.boundaries.length - 1]).toBe(passage.text.length)
    }
  })

  it('shortened passages reduce typing volume as well as sentence count', () => {
    const passages = loadContent().passages
    for (const id of ['p-molecules', 'p-pathways', 'p-context', 'p-medication', 'p-confounding']) {
      const words = passages[id].text.trim().split(/\s+/).length
      expect(words).toBeGreaterThanOrEqual(50)
      expect(words).toBeLessThanOrEqual(58)
    }
  })

  it.each([49, 50, 90, 91])('enforces the 50-90 word range (%i words)', (words) => {
    const c = loadContent()
    c.data.passages[0].text = Array(words).fill('word').join(' ')
    if (words < 50 || words > 90) expect(() => c.validate()).toThrow('must have 50-90 words')
    else expect(() => c.validate()).not.toThrow()
  })
})
