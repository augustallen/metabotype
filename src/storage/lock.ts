/**
 * One tab owns the history at a time, replacing the CLI's file lock.
 * Web Locks provide atomic ownership. Browsers without them cannot safely save.
 */

export const LOCK_NAME = 'metabotype-owner'

export interface OwnerLock {
  acquired: boolean
  release(): void
}

async function withWebLocks(steal: boolean, onLost: () => void): Promise<OwnerLock> {
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  let owning = false
  const acquired = await new Promise<boolean>((resolve, reject) => {
    navigator.locks.request(LOCK_NAME, steal ? { steal: true } : { ifAvailable: true }, async (lock) => {
      if (!lock) {
        resolve(false)
        return
      }
      owning = true
      resolve(true)
      await held
    }).catch((error: unknown) => {
      if (owning) {
        owning = false
        release()
        onLost()
      } else {
        // Permission/security failures must reject startup rather than leave it waiting forever.
        reject(error)
      }
    })
  })
  return {
    acquired,
    release() {
      owning = false
      release()
    },
  }
}

export async function acquireOwnership(options: { steal?: boolean; onLost: () => void }): Promise<OwnerLock> {
  const steal = options.steal ?? false
  if (typeof navigator !== 'undefined' && navigator.locks) return withWebLocks(steal, options.onLost)
  throw new Error('This browser cannot safely coordinate history between tabs. Open Metabotype over HTTPS in a browser that supports Web Locks.')
}
