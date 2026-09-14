/** One IndexedDB record holds the whole history document. Writes are coalesced and ordered. */
import { validateModel, type Model } from './model.ts'

export const DB_NAME = 'metabotype'
const STORE = 'documents'
const KEY = 'history'

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => {
      const db = req.result
      // Another tab upgrading or deleting the database: let go so it can proceed.
      db.onversionchange = () => db.close()
      resolve(db)
    }
    req.onerror = () => reject(req.error ?? new Error('Could not open IndexedDB'))
    req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'))
  })
}

export async function loadModel(db: IDBDatabase): Promise<Model | null> {
  const tx = db.transaction(STORE, 'readonly')
  const stored = await request(tx.objectStore(STORE).get(KEY))
  return stored ? validateModel(stored) : null
}

export function writeModel(db: IDBDatabase, model: Model): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(model, KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })
}

/** Serial, coalescing writer: the newest document always lands last. */
export class Saver {
  private pending: Model | null = null
  private writing: Promise<void> | null = null
  private stopped = false
  private replacing = false
  failed: Error | null = null

  constructor(private db: IDBDatabase, private onError: (error: Error) => void = () => {}) {}

  save(model: Model): void {
    if (this.stopped || this.replacing) return
    this.pending = model
    if (!this.writing) this.writing = this.drain()
  }

  /** Import through the same writer, so older queued state cannot overwrite the replacement. */
  async replace(model: Model): Promise<void> {
    if (this.stopped) throw new Error('History ownership was lost. Reload before restoring a backup.')
    if (this.replacing) throw new Error('A backup is already being restored.')
    this.replacing = true
    try {
      // Coalesce any queued old state into the replacement; the active transaction finishes first.
      this.pending = model
      if (!this.writing) this.writing = this.drain()
      await this.flush()
      if (this.stopped) throw new Error('History ownership was lost. Reload before restoring a backup.')
      if (this.failed) throw this.failed
    } finally {
      this.replacing = false
    }
  }

  /** Ownership was lost: let the current transaction finish, but never queue another. */
  stop(): void {
    this.stopped = true
    this.pending = null
  }

  /** Resolves once every queued document has been written. */
  flush(): Promise<void> {
    return this.writing ?? Promise.resolve()
  }

  private async drain(): Promise<void> {
    while (this.pending) {
      const model = this.pending
      this.pending = null
      try {
        await writeModel(this.db, model)
        this.failed = null
      } catch (error) {
        this.failed = error as Error
        this.onError(error as Error)
      }
    }
    this.writing = null
  }
}

export interface StorageStatus { persisted: boolean | null; usage: number | null; quota: number | null }

export async function storageStatus(): Promise<StorageStatus> {
  const status: StorageStatus = { persisted: null, usage: null, quota: null }
  if (typeof navigator === 'undefined' || !navigator.storage) return status
  try {
    if (navigator.storage.persisted) status.persisted = await navigator.storage.persisted()
    if (navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate()
      status.usage = estimate.usage ?? null
      status.quota = estimate.quota ?? null
    }
  } catch {
    // Some browsers throw in private windows; the status stays unknown.
  }
  return status
}

export async function requestPersistence(): Promise<boolean> {
  try {
    return navigator.storage?.persist ? await navigator.storage.persist() : false
  } catch {
    return false
  }
}
