import { useEffect, useLayoutEffect, useState } from 'preact/hooks'

type KeyHandler = (event: KeyboardEvent) => boolean | void

/** Handlers stack in mount order; only the topmost layer (a sheet over a screen) receives keys. */
const stack: KeyHandler[] = []
let listening = false

function dispatch(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.key === 'Tab') return
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select') || target?.isContentEditable) return
  // Native activation belongs to the focused control, even if a screen also uses Enter.
  if ((event.key === 'Enter' || event.key === ' ') && target?.closest('button, a[href], summary, [role="button"], [role="tab"], [role="radio"]')) return
  const top = stack[stack.length - 1]
  if (top && top(event)) event.preventDefault()
}

/**
 * Document-level shortcuts for one screen; the handler returns true when it consumed the key.
 * Registered in a layout effect so a key pressed right after navigation is never missed.
 */
export function useKeys(handler: KeyHandler, deps: unknown[] = []): void {
  useLayoutEffect(() => {
    if (!listening) {
      document.addEventListener('keydown', dispatch)
      listening = true
    }
    stack.push(handler)
    return () => {
      const index = stack.lastIndexOf(handler)
      if (index >= 0) stack.splice(index, 1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches)
  useEffect(() => {
    const list = matchMedia(query)
    const update = () => setMatches(list.matches)
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])
  return matches
}

export function useFinePointer(): boolean {
  return useMediaQuery('(pointer: fine)')
}

/** Element width in CSS pixels, tracked with ResizeObserver. */
export function useWidth(ref: { current: HTMLElement | null }, fallback = 320): number {
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(Math.max(120, Math.floor(el.getBoundingClientRect().width)))
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return width
}
