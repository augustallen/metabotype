import type { ComponentChildren } from 'preact'
import { useFinePointer } from './hooks.ts'

export function metric(value: number | null | undefined, suffix = ''): string {
  return value === null || value === undefined ? '--' : `${value.toFixed(1)}${suffix}`
}

export function Kbd({ children }: { children: ComponentChildren }) {
  const fine = useFinePointer()
  return fine ? <kbd class="kbd">{children}</kbd> : null
}

export function Frame(props: { title: string; children: ComponentChildren; bar?: ComponentChildren; hint?: ComponentChildren; wide?: boolean; back?: () => void; backLabel?: string }) {
  return (
    <section class={`frame ${props.wide ? 'frame-wide' : ''}`}>
      <header class="frame-head">
        {props.back
          ? <button class="ghost back" type="button" onClick={props.back} aria-label={props.backLabel ?? 'Back'}>‹</button>
          : <span class="brand">m / metabotype</span>}
        <h1 class="frame-title">{props.title}</h1>
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
  return (
    <div class="sheet-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) props.onClose() }}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={props.title}>
        <div class="sheet-grip" aria-hidden="true" />
        <h2 class="sheet-title">{props.title}</h2>
        {props.children}
      </div>
    </div>
  )
}
