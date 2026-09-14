import { render } from 'preact'
import { registerSW } from 'virtual:pwa-register'
import curriculum from '../content/curriculum.json'
import { Content } from './core/content.ts'
import { Store } from './storage/store.ts'
import { loadModel, openDatabase, Saver } from './storage/persist.ts'
import { acquireOwnership, type OwnerLock } from './storage/lock.ts'
import { createTypingField } from './input/typing-field.ts'
import { attachRecorder, enabled as recorderEnabled } from './input/recorder.ts'
import { Game } from './ui/game.ts'
import { App } from './ui/app.tsx'
import { OtherTab } from './ui/screens.tsx'
import { Button, Frame } from './ui/components.tsx'
import './ui/styles.css'
import './ui/motion.css'

const root = document.getElementById('app')!

function fatal(message: string) {
  render(
    <Frame title="Metabotype can't start" bar={<Button primary onClick={() => location.reload()}>Try again</Button>}>
      <div class="prose"><p>{message}</p></div>
    </Frame>, root)
}

async function boot(steal = false): Promise<void> {
  const content = new Content(curriculum)
  let game: Game | null = null
  let saver: Saver | null = null
  let lost = false
  let lock: OwnerLock
  try {
    lock = await acquireOwnership({ steal, onLost: () => {
      lost = true
      saver?.stop()
      game?.lost()
    } })
  } catch (error) {
    fatal(`Could not secure history access: ${(error as Error).message}`)
    return
  }
  if (!lock.acquired) {
    render(<OtherTab lost={false} onUseHere={() => { void boot(true) }} />, root)
    return
  }
  let db: IDBDatabase | null = null
  let model
  try {
    db = await openDatabase()
    model = await loadModel(db)
  } catch (error) {
    db?.close()
    lock.release()
    fatal(`Could not load history: ${(error as Error).message}. History is stored in this browser's IndexedDB. Private windows and some embedded browsers block it.`)
    return
  }
  // A takeover can happen while IndexedDB is opening or loading. Do not start a stale session.
  if (lost) {
    db.close()
    lock.release()
    render(<OtherTab lost onUseHere={() => { void boot(true) }} />, root)
    return
  }
  const field = createTypingField()
  saver = new Saver(db, (error) => { if (game) game.saveError.value = `Saving failed: ${error.message}. Export a backup soon.` })
  const store = new Store(model, () => Date.now() / 1000, (m) => saver!.save(m))
  const recovered = store.startSession()
  game = new Game(content, store, field, async (model) => {
    await saver!.replace(model)
    // pagehide must not save the old session over a successful import.
    store.model = model
    store.session = null
  })
  if (recovered) game.notice.value = `Recovered ${recovered} unfinished round(s). Saved typing results are intact.`
  if (recorderEnabled()) mountRecorder(field.el)
  render(<App game={game} />, root)
  const update = registerSW({
    onNeedRefresh() {
      // Never swap code mid-round; the home screen offers the update.
      if (game) game.updateReady.value = () => { void update(true) }
    },
  })
}

function mountRecorder(el: HTMLInputElement) {
  const recorder = attachRecorder(el)
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'recorder-btn'
  button.textContent = 'Copy input trace'
  button.onclick = async () => {
    const text = recorder.text()
    try {
      await navigator.clipboard.writeText(text)
      button.textContent = `Copied ${recorder.events.length} events`
    } catch {
      const w = window.open('', '_blank')
      if (w) w.document.body.textContent = text
    }
    setTimeout(() => { button.textContent = 'Copy input trace' }, 2000)
  }
  document.body.appendChild(button)
}

void boot()
