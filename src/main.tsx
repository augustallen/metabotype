import { render } from 'preact'
import { registerSW } from 'virtual:pwa-register'
import curriculum from '../content/curriculum.json'
import { Content } from './core/content.ts'
import { Store } from './storage/store.ts'
import { loadModel, openDatabase, Saver } from './storage/persist.ts'
import { acquireOwnership } from './storage/lock.ts'
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
      <div class="prose"><p>{message}</p><p>History is stored in this browser's IndexedDB. Private windows and some embedded browsers block it.</p></div>
    </Frame>, root)
}

async function boot(steal = false): Promise<void> {
  const content = new Content(curriculum)
  const field = createTypingField()
  let game: Game | null = null
  const lock = await acquireOwnership({ steal, onLost: () => game?.lost() })
  if (!lock.acquired) {
    render(<OtherTab lost={false} onUseHere={() => { void boot(true) }} />, root)
    return
  }
  let db: IDBDatabase
  let model
  try {
    db = await openDatabase()
    model = await loadModel(db)
  } catch (error) {
    fatal((error as Error).message)
    return
  }
  const saver = new Saver(db, (error) => { if (game) game.saveError.value = `Saving failed: ${error.message}. Export a backup soon.` })
  const store = new Store(model, () => Date.now() / 1000, (m) => saver.save(m))
  const recovered = store.startSession()
  game = new Game(content, store, field)
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
