import { useEffect } from 'preact/hooks'
import type { Game } from './game.ts'
import { Data, DetailsSheet, Help, Home, Notebook, OtherTab, PasteNotice, PauseSheet, Quiz, Results, Rounds, Topics, Typing } from './screens.tsx'

export function App({ game }: { game: Game }) {
  const screen = game.screen.value
  const overlay = game.overlay.value
  useLifecycle(game)
  let body
  switch (screen) {
    case 'home': body = <Home game={game} />; break
    case 'topics': body = <Topics game={game} />; break
    case 'typing': body = <Typing game={game} />; break
    case 'quiz': body = <Quiz game={game} />; break
    case 'results': body = <Results game={game} />; break
    case 'notebook': body = <Notebook game={game} />; break
    case 'rounds': body = <Rounds game={game} />; break
    case 'data': body = <Data game={game} />; break
    case 'paste': body = <PasteNotice game={game} />; break
    case 'other-tab': body = <OtherTab lost onUseHere={() => location.reload()} />; break
    default: body = <Home game={game} />
  }
  return (
    <div class={`app screen-${screen}`} data-screen={screen}>
      {body}
      {overlay === 'pause' ? <PauseSheet game={game} /> : null}
      {overlay === 'help' ? <Help game={game} asSheet /> : null}
      {overlay === 'details' ? <DetailsSheet game={game} /> : null}
    </div>
  )
}

/** Pause and checkpoint on the events that take the keyboard away; track the virtual keyboard. */
function useLifecycle(game: Game) {
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) {
        game.checkpoint()
        game.pause()
      }
    }
    const blurred = () => game.pause()
    const unload = () => game.store.close()
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('blur', blurred)
    window.addEventListener('pagehide', unload)
    const vv = window.visualViewport
    let lastHeight = vv ? vv.height : window.innerHeight
    const viewport = () => {
      if (!vv) return
      document.documentElement.style.setProperty('--vvh', `${vv.height}px`)
      document.documentElement.style.setProperty('--vvtop', `${vv.offsetTop}px`)
      if (vv.height < window.innerHeight * 0.75 && game.field.focused) game.virtualKeyboardSeen = true
      const coarse = matchMedia('(pointer: coarse)').matches
      if (coarse && vv.height - lastHeight >= 150 && game.screen.value === 'typing') game.pause()
      lastHeight = vv.height
    }
    vv?.addEventListener('resize', viewport)
    vv?.addEventListener('scroll', viewport)
    viewport()
    const nav = navigator as Navigator & { virtualKeyboard?: { overlaysContent: boolean; addEventListener: (t: string, cb: () => void) => void } }
    nav.virtualKeyboard?.addEventListener('geometrychange', () => { game.virtualKeyboardSeen = true })
    return () => {
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('blur', blurred)
      window.removeEventListener('pagehide', unload)
      vv?.removeEventListener('resize', viewport)
      vv?.removeEventListener('scroll', viewport)
    }
  }, [game])
}
