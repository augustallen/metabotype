import { describe, expect, it } from 'vitest'
import { capitalizeSentenceStart, normalizeText, reconcile, wordDelete } from '../../src/input/reconcile.ts'
import { TypingState } from '../../src/core/typing.ts'

/** Drive a TypingState the way the field controller does: mirror, edit, diff, feed. */
function session(target: string) {
  const state = new TypingState(target, () => 0)
  const mirror = () => state.buffer + (state.pendingPeriod ? ' ' : '')
  let last = mirror()
  const edit = (value: string, inputType = 'insertText') => {
    const r = reconcile(last, value, inputType)
    for (const key of r.keys) state.feed(key)
    last = mirror()
    return { r, field: last }
  }
  return { state, edit, mirror }
}

describe('reconcile', () => {
  it('plain typing yields one key per character', () => {
    expect(reconcile('', 'H').keys).toEqual(['H'])
    expect(reconcile('H', 'Hi').keys).toEqual(['i'])
    expect(reconcile('Hi', 'Hi').keys).toEqual([])
  })

  it('backspace and OS word delete', () => {
    expect(reconcile('Hi', 'H', 'deleteContentBackward').keys).toEqual(['BACKSPACE'])
    expect(reconcile('alpha beta', 'alpha ', 'deleteWordBackward').keys).toEqual(['WORD_BACKSPACE'])
    expect(reconcile('alpha beta ', 'alpha ', 'deleteContentBackward').keys).toEqual(['WORD_BACKSPACE'])
    // A partial-word removal is ordinary backspacing.
    expect(reconcile('alpha beta', 'alpha be', 'deleteContentBackward').keys).toEqual(['BACKSPACE', 'BACKSPACE'])
    // Cmd+Backspace clears the whole line: honest backspaces, not a word delete.
    expect(reconcile('alpha beta', '', 'deleteSoftLineBackward').keys).toEqual(Array(10).fill('BACKSPACE'))
    expect(wordDelete('one two   ')).toBe('one ')
  })

  it('the OS double-space period is the player pressing space again', () => {
    const { state, edit } = session('Hi. Bye.')
    edit('H')
    edit('Hi')
    edit('Hi ')
    expect(state.pendingPeriod).toBe(true)
    const { r, field } = edit('Hi. ')
    expect(r.keys).toEqual([' '])
    expect(state.sentenceIndex).toBe(1)
    expect(state.buffer).toBe('')
    expect(field).toBe('')
    edit('B')
    edit('By')
    edit('Bye')
    edit('Bye ')
    const done = edit('Bye. ')
    expect(done.r.keys).toEqual([' '])
    expect(state.complete).toBe(true)
    expect(state.metrics().accuracy).toBe(100)
    expect(state.metrics().period_shortcuts).toBe(2)
  })

  it('a typed period after a pending space is literal input', () => {
    const { state, edit } = session('Hi there.')
    for (const v of ['H', 'Hi', 'Hi ', 'Hi t']) edit(v)
    expect(state.buffer).toBe('Hi t')
    expect(state.metrics().incorrect_attempts).toBe(0)
  })

  it('paste and drop invalidate instead of feeding keys', () => {
    const r = reconcile('', 'A whole passage.', 'insertFromPaste')
    expect(r.paste).toBe(true)
    expect(r.keys).toEqual([])
    expect(reconcile('', 'x', 'insertFromDrop').paste).toBe(true)
  })

  it('smart punctuation is rewritten and counted', () => {
    expect(normalizeText('it’s').keys.join('')).toBe("it's")
    const r = reconcile('it', 'it’', 'insertText')
    expect(r.keys).toEqual(["'"])
    expect(r.normalized).toBe(1)
    expect(reconcile('', '“q”').keys).toEqual(['"', 'q', '"'])
    expect(reconcile('', 'a—b').keys).toEqual(['a', '-', 'b'])
    expect(reconcile('', '…').keys).toEqual(['.', '.', '.'])
    expect(reconcile('', 'x\ny').keys).toEqual(['x', 'y'])
  })

  it('emoji become one wrong key rather than two', () => {
    const r = reconcile('', '\u{1F600}')
    expect(r.keys).toEqual(['�'])
    const s = new TypingState('ab')
    for (const k of r.keys) s.feed(k)
    expect(s.metrics().incorrect_attempts).toBe(1)
    expect(s.buffer.length).toBe(1)
  })

  it('predictions and swipe words are counted, not rejected', () => {
    const swipe = reconcile('', 'alpha ', 'insertCompositionText')
    expect(swipe.keys.join('')).toBe('alpha ')
    expect(swipe.multi).toBe(1)
    const fix = reconcile('Teh ', 'The ', 'insertReplacementText')
    expect(fix.keys).toEqual(['BACKSPACE', 'BACKSPACE', 'BACKSPACE', 'h', 'e', ' '])
    expect(fix.assisted).toBe(1)
    expect(reconcile('a', 'ab', 'insertCompositionText').multi).toBe(0)
  })

  it('a swiped word starting a sentence gets its capital', () => {
    expect(capitalizeSentenceStart(['s', 'u', 'g', 'a', 'r', 's', ' '], '', 'S')).toEqual({ keys: ['S', 'u', 'g', 'a', 'r', 's', ' '], normalized: 1 })
    expect(capitalizeSentenceStart(['i', 'n'], '', 'I').keys).toEqual(['I', 'n'])
    // Already capitalized, mid-sentence, a single tapped key, or a different letter: untouched.
    expect(capitalizeSentenceStart(['S', 'u', 'g'], '', 'S').normalized).toBe(0)
    expect(capitalizeSentenceStart(['f', 'l', 'o', 'w'], 'Sugars ', 'f').normalized).toBe(0)
    expect(capitalizeSentenceStart(['s'], '', 'S')).toEqual({ keys: ['s'], normalized: 0 })
    expect(capitalizeSentenceStart(['t', 'h', 'e'], '', 'S')).toEqual({ keys: ['t', 'h', 'e'], normalized: 0 })
    expect(capitalizeSentenceStart(['.', '.'], '', '.').normalized).toBe(0)
  })

  it('a full passage typed through the field scores exactly like the terminal', () => {
    const target = 'A cell is busy. Sugars flow. Done.'
    const { state, edit } = session(target)
    let field = ''
    for (const ch of target) {
      if (state.complete) break
      field = field + ch
      const { field: after } = edit(field)
      field = after
    }
    expect(state.complete).toBe(true)
    expect(state.metrics().accuracy).toBe(100)
    expect(state.metrics().accepted_count).toBe(target.length)
  })
})
