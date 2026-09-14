/**
 * Turn text-field edits into game keystrokes.
 *
 * Phones don't deliver reliable per-key events, so the hidden field mirrors
 * the current sentence buffer and each `input` event is diffed against the
 * value we last wrote. The result feeds TypingState exactly like a keyboard.
 */

export interface Reconciled {
  keys: string[]
  /** Pasted or dropped text: the round can no longer be scored. */
  paste: boolean
  /** Predictive-text or autocorrect replacements. */
  assisted: number
  /** Single edits that inserted three or more characters (swipe, dictation). */
  multi: number
  /** Characters rewritten to ASCII (smart quotes, dashes). */
  normalized: number
}

export const PASTE_TYPES = new Set(['insertFromPaste', 'insertFromPasteAsQuotation', 'insertFromDrop', 'insertFromYank'])
export const HISTORY_TYPES = new Set(['historyUndo', 'historyRedo'])

const SUBSTITUTIONS: Record<string, string> = {
  '‘': "'", '’': "'", 'ʼ': "'", '′': "'",
  '“': '"', '”': '"', '″': '"',
  '–': '-', '—': '-', '−': '-',
  '…': '...', ' ': ' ', ' ': ' ', ' ': ' ',
}

/** Map one UTF-16 unit (or surrogate pair) to the keys the game should see. */
export function normalizeText(text: string): { keys: string[]; normalized: number } {
  const keys: string[] = []
  let normalized = 0
  for (const ch of text) {
    if (ch === '\n' || ch === '\r' || ch === '\t') continue
    if (ch in SUBSTITUTIONS) {
      keys.push(...SUBSTITUTIONS[ch])
      normalized++
    } else if (ch.length > 1) {
      // Astral characters (emoji) can't match ASCII targets; keep one wrong key.
      keys.push('�')
      normalized++
    } else {
      keys.push(ch)
    }
  }
  return { keys, normalized }
}

/**
 * Swipe and predictive keyboards don't reliably capitalize a new sentence, since the field is
 * cleared at every sentence break. When one edit inserts a word at the start of a sentence and its
 * first letter differs from the target only by case, that is the keyboard's casing: fix it.
 * A single typed key is left alone, so a tapped lowercase letter still counts as a mistake.
 */
export function capitalizeSentenceStart(keys: string[], buffer: string, expected: string): { keys: string[]; normalized: number } {
  const first = keys[0]
  if (buffer !== '' || keys.length < 2 || first === expected || first.toUpperCase() !== expected) {
    return { keys, normalized: 0 }
  }
  return { keys: [expected, ...keys.slice(1)], normalized: 1 }
}

/** The game's own word delete, used to recognise OS word deletes. */
export function wordDelete(text: string): string {
  const trimmed = text.replace(/ +$/, '')
  return trimmed.slice(0, trimmed.lastIndexOf(' ') + 1)
}

function commonPrefix(a: string, b: string): number {
  const limit = Math.min(a.length, b.length)
  let i = 0
  while (i < limit && a[i] === b[i]) i++
  return i
}

export function reconcile(prev: string, next: string, inputType = ''): Reconciled {
  const result: Reconciled = { keys: [], paste: false, assisted: 0, multi: 0, normalized: 0 }
  if (PASTE_TYPES.has(inputType)) {
    result.paste = true
    return result
  }
  if (prev === next) return result
  // iOS and Gboard turn a second space into ". ": the player physically pressed space again.
  if (prev.endsWith(' ') && next === prev.slice(0, -1) + '. ') {
    result.keys.push(' ')
    return result
  }
  const p = commonPrefix(prev, next)
  const removed = prev.length - p
  if (removed > 0) {
    const asWord = wordDelete(prev)
    if ((removed > 1 || inputType.startsWith('deleteWord')) && asWord === prev.slice(0, p) && asWord !== prev) {
      result.keys.push('WORD_BACKSPACE')
    } else {
      for (let i = 0; i < removed; i++) result.keys.push('BACKSPACE')
    }
  }
  const inserted = next.slice(p)
  if (inserted) {
    const { keys, normalized } = normalizeText(inserted)
    result.keys.push(...keys)
    result.normalized = normalized
    if (inputType === 'insertReplacementText') result.assisted = 1
    if (keys.length >= 3) result.multi = 1
  }
  return result
}
