/**
 * One tab owns the history at a time, replacing the CLI's file lock.
 * Web Locks when available (secure contexts); a BroadcastChannel handshake otherwise.
 */

export const LOCK_NAME = 'metabotype-owner'
export const CHANNEL_NAME = 'metabotype'

export interface OwnerLock {
  acquired: boolean
  release(): void
}

type Message = { type: 'ping' } | { type: 'pong' } | { type: 'steal' } | { type: 'reload' }

export function openChannel(): BroadcastChannel | null {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME)
}

async function withWebLocks(steal: boolean, onLost: () => void): Promise<OwnerLock> {
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  const acquired = await new Promise<boolean>((resolve) => {
    navigator.locks.request(LOCK_NAME, steal ? { steal: true } : { ifAvailable: true }, async (lock) => {
      if (!lock) {
        resolve(false)
        return
      }
      resolve(true)
      await held
    }).catch((error: DOMException) => {
      // Our lock was stolen by a tab that pressed "Use here".
      if (error && error.name === 'AbortError') onLost()
    })
  })
  return { acquired, release }
}

async function withChannel(steal: boolean, onLost: () => void): Promise<OwnerLock> {
  const channel = openChannel()
  if (!channel) return { acquired: true, release() {} }
  const post = (message: Message) => channel.postMessage(message)
  let owner = false
  const someoneElse = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 250)
    channel.onmessage = (event: MessageEvent<Message>) => {
      if (event.data?.type === 'pong') {
        clearTimeout(timer)
        resolve(true)
      }
    }
    post({ type: 'ping' })
  })
  const taken = await someoneElse
  if (taken && !steal) {
    channel.close()
    return { acquired: false, release() {} }
  }
  if (steal) post({ type: 'steal' })
  owner = true
  channel.onmessage = (event: MessageEvent<Message>) => {
    if (!owner) return
    if (event.data?.type === 'ping') post({ type: 'pong' })
    if (event.data?.type === 'steal') {
      owner = false
      onLost()
    }
  }
  return {
    acquired: true,
    release() {
      owner = false
      channel.close()
    },
  }
}

export function acquireOwnership(options: { steal?: boolean; onLost: () => void }): Promise<OwnerLock> {
  const steal = options.steal ?? false
  if (typeof navigator !== 'undefined' && navigator.locks) return withWebLocks(steal, options.onLost)
  return withChannel(steal, options.onLost)
}
