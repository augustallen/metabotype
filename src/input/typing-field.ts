/**
 * The hidden text field that phones and desktops type into.
 *
 * It mirrors the game's sentence buffer; every input event is diffed by
 * reconcile() into keystrokes. Text never comes from keydown, which keeps
 * Android's key-229 events and IME composition out of the scoring path.
 */
import { HISTORY_TYPES, PASTE_TYPES, reconcile, type Reconciled } from './reconcile.ts'

export interface FieldHandlers {
  onKeys(keys: string[], stats: Reconciled): void
  onPaste(): void
  onBlur(): void
  onControl(key: 'Escape' | 'F1' | 'Enter'): void
  /** Android keyboards report keyCode 229 for text keys: a virtual keyboard is present. */
  onKey229(): void
}

/** Keys we synthesise ourselves edit no text, so they carry no input statistics. */
const NO_EDIT: Reconciled = Object.freeze({ keys: [], paste: false, assisted: 0, multi: 0, normalized: 0 })

export class TypingField {
  private last = ''
  private composing = false
  private handlers: FieldHandlers | null = null
  private mirrorSource: (() => string) | null = null
  active = false

  constructor(readonly el: HTMLInputElement) {
    el.addEventListener('beforeinput', this.onBeforeInput)
    el.addEventListener('input', this.onInput)
    el.addEventListener('compositionstart', () => { this.composing = true })
    el.addEventListener('compositionend', () => {
      this.composing = false
      this.resync()
    })
    el.addEventListener('keydown', this.onKeyDown)
    el.addEventListener('blur', () => { if (this.active) this.handlers?.onBlur() })
    el.addEventListener('paste', (event) => { event.preventDefault(); if (this.active) this.handlers?.onPaste() })
    el.addEventListener('drop', (event) => { event.preventDefault(); if (this.active) this.handlers?.onPaste() })
    document.addEventListener('selectionchange', this.onSelectionChange)
  }

  /** Start a round: handlers receive keys until stop(). */
  start(handlers: FieldHandlers, mirror: () => string): void {
    this.handlers = handlers
    this.mirrorSource = mirror
    this.active = true
    this.composing = false
    this.resync()
  }

  stop(): void {
    this.active = false
    this.handlers = null
    this.mirrorSource = null
    this.el.value = ''
    this.last = ''
  }

  focus(): void {
    // Must run synchronously inside a user gesture for iOS to open the keyboard.
    this.el.focus({ preventScroll: true })
    this.moveCaretToEnd()
  }

  blur(): void {
    this.el.blur()
  }

  get focused(): boolean {
    return document.activeElement === this.el
  }

  /** Rewrite the field from the game buffer (after each keystroke, outside composition). */
  resync(): void {
    if (!this.mirrorSource || this.composing) return
    const mirror = this.mirrorSource()
    if (this.el.value !== mirror) this.el.value = mirror
    this.last = mirror
    this.moveCaretToEnd()
  }

  private moveCaretToEnd(): void {
    const end = this.el.value.length
    try {
      if (this.el.selectionStart !== end || this.el.selectionEnd !== end) this.el.setSelectionRange(end, end)
    } catch {
      // Some input types refuse selection APIs; the caret is invisible anyway.
    }
  }

  private onBeforeInput = (event: InputEvent) => {
    if (!this.active) return
    if (PASTE_TYPES.has(event.inputType) || HISTORY_TYPES.has(event.inputType)) {
      event.preventDefault()
      if (PASTE_TYPES.has(event.inputType)) this.handlers?.onPaste()
    }
    if (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph') {
      event.preventDefault()
      this.handlers?.onControl('Enter')
    }
  }

  private onInput = (event: Event) => {
    if (!this.active || !this.handlers) return
    const inputType = (event as InputEvent).inputType ?? ''
    const value = this.el.value
    const result = reconcile(this.last, value, inputType)
    if (result.paste) {
      this.handlers.onPaste()
      return
    }
    if (result.keys.length) this.handlers.onKeys(result.keys, result)
    if (this.composing) this.last = value
    else this.resync()
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (!this.active) return
    if (event.keyCode === 229 || event.isComposing) {
      this.handlers?.onKey229()
      return
    }
    if (event.key === 'Escape' || event.key === 'F1' || event.key === 'Enter') {
      event.preventDefault()
      this.handlers?.onControl(event.key)
      return
    }
    // Word delete belongs to the game, not the OS. Browsers bind the chord to
    // whatever the platform says: macOS turns Ctrl+Backspace into a single
    // character and Linux ignores Alt+Backspace, so the shortcut the help
    // promises only works everywhere if we emit it ourselves.
    if (event.key === 'Backspace' && (event.altKey || event.ctrlKey)) {
      event.preventDefault()
      this.handlers?.onKeys(['WORD_BACKSPACE'], NO_EDIT)
      this.resync()
    }
  }

  private onSelectionChange = () => {
    // Defeat the iOS space-bar trackpad and long-press caret moves: edits happen at the end only.
    if (this.active && this.focused && !this.composing) this.moveCaretToEnd()
  }
}

export function createTypingField(): TypingField {
  const el = document.getElementById('typing-field') as HTMLInputElement | null
  if (!el) throw new Error('typing field missing from the page')
  return new TypingField(el)
}
