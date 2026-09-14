import type { ComponentChildren } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import { useFinePointer } from './hooks.ts'

export function metric(value: number | null | undefined, suffix = ''): string {
  return value === null || value === undefined ? '--' : `${value.toFixed(1)}${suffix}`
}

export function Kbd({ children }: { children: ComponentChildren }) {
  const fine = useFinePointer()
  return fine ? <kbd class="kbd">{children}</kbd> : null
}

export function Frame(props: { title: string; children: ComponentChildren; bar?: ComponentChildren; hint?: ComponentChildren; wide?: boolean; back?: () => void; backLabel?: string; hideTitle?: boolean }) {
  return (
    <section class={`frame ${props.wide ? 'frame-wide' : ''}`}>
      <header class="frame-head">
        {props.back
          ? <button class="ghost back" type="button" onClick={props.back} aria-label={props.backLabel ?? 'Back'}>‹</button>
          : <span class="brand">m / metabotype</span>}
        <h1 class={props.hideTitle ? 'visually-hidden' : 'frame-title'}>{props.title}</h1>
      </header>
      <div class="frame-body">{props.children}</div>
      {props.hint ? <div class="hint">{props.hint}</div> : null}
      {props.bar ? <footer class="bar">{props.bar}</footer> : null}
    </section>
  )
}

export function Button(props: { onClick: () => void; children: ComponentChildren; primary?: boolean; disabled?: boolean; class?: string; ariaLabel?: string }) {
  return (
    <button type="button" class={`btn ${props.primary ? 'primary' : ''} ${props.class ?? ''}`} onClick={props.onClick}
      disabled={props.disabled} aria-label={props.ariaLabel}>
      {props.children}
    </button>
  )
}

/** A scrolling page of text with one Back action. */
export function Page(props: { title: string; lines: ComponentChildren; onBack: () => void; back?: string }) {
  return (
    <Frame title={props.title} back={props.onBack}
      bar={<Button primary onClick={props.onBack}>{props.back ?? 'Back'} <Kbd>Esc</Kbd></Button>}>
      <div class="prose">{props.lines}</div>
    </Frame>
  )
}

/** Bottom sheet for pause and details. */
export function Sheet(props: { title: string; children: ComponentChildren; onClose: () => void; closeLabel?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const sheet = ref.current!
    const previous = document.activeElement as HTMLElement | null
    const controls = () => Array.from(sheet.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]'))
      .filter((el) => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0)
    const focusFirst = () => (controls()[0] ?? sheet).focus({ preventScroll: true })
    const cycleFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      event.preventDefault()
      const items = controls()
      const current = items.indexOf(document.activeElement as HTMLElement)
      const next = current < 0
        ? (event.shiftKey ? items.length - 1 : 0)
        : (current + (event.shiftKey ? -1 : 1) + items.length) % items.length
      // Safari may skip buttons during native Tab navigation. Advance explicitly
      // so every dialog control is reachable and focus cannot escape the sheet.
      const target = items[next] ?? sheet
      target.focus()
    }
    focusFirst()
    sheet.addEventListener('keydown', cycleFocus)
    // Tab stays inside the modal; screen shortcuts continue to handle Escape.
    // Do not intercept programmatic focus: resuming a round focuses the typing field
    // before Preact removes the sheet.
    return () => {
      sheet.removeEventListener('keydown', cycleFocus)
      if (previous?.isConnected && (sheet.contains(document.activeElement) || document.activeElement === document.body)) {
        previous.focus({ preventScroll: true })
      }
    }
  }, [])
  return (
    <div class="sheet-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) props.onClose() }}>
      <div ref={ref} class="sheet" role="dialog" aria-modal="true" aria-label={props.title} tabIndex={-1}>
        <div class="sheet-grip" aria-hidden="true" />
        <h2 class="sheet-title">{props.title}</h2>
        {props.children}
      </div>
    </div>
  )
}
