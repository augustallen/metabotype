/**
 * Input trace recorder, enabled with ?debug=input. Logs the raw events the
 * hidden field receives so a keyboard's behaviour can be replayed in tests.
 */

export interface TraceEvent {
  t: number
  type: string
  inputType?: string
  data?: string | null
  value?: string
  key?: string
  keyCode?: number
  composing?: boolean
  start?: number | null
  end?: number | null
}

export function enabled(): boolean {
  return new URLSearchParams(location.search).get('debug') === 'input'
}

export function attachRecorder(el: HTMLInputElement): { events: TraceEvent[]; text(): string } {
  const events: TraceEvent[] = []
  const t0 = performance.now()
  const snap = (type: string, extra: Partial<TraceEvent> = {}) => {
    events.push({
      t: Math.round(performance.now() - t0), type, value: el.value,
      start: el.selectionStart, end: el.selectionEnd, ...extra,
    })
    if (events.length > 5000) events.shift()
  }
  for (const type of ['beforeinput', 'input']) {
    el.addEventListener(type, (event) => {
      const e = event as InputEvent
      snap(type, { inputType: e.inputType, data: e.data, composing: e.isComposing })
    })
  }
  for (const type of ['compositionstart', 'compositionupdate', 'compositionend']) {
    el.addEventListener(type, (event) => snap(type, { data: (event as CompositionEvent).data }))
  }
  el.addEventListener('keydown', (event) => snap('keydown', { key: event.key, keyCode: event.keyCode, composing: event.isComposing }))
  el.addEventListener('keyup', (event) => snap('keyup', { key: event.key, keyCode: event.keyCode }))
  el.addEventListener('focus', () => snap('focus'))
  el.addEventListener('blur', () => snap('blur'))
  const meta = {
    ua: navigator.userAgent, platform: navigator.platform, width: innerWidth, height: innerHeight,
    coarse: matchMedia('(pointer: coarse)').matches, recorded: new Date().toISOString(),
  }
  return { events, text: () => JSON.stringify({ meta, events }, null, 0) }
}
