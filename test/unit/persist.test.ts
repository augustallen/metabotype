import { describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { Store } from '../../src/storage/store.ts'
import { loadModel, openDatabase, Saver, writeModel } from '../../src/storage/persist.ts'
import { emptyModel } from '../../src/storage/model.ts'
import { loadContent } from '../helpers.ts'

describe('persistence', () => {
  it('serializes an import after the active write and prevents old state replacing it', async () => {
    globalThis.indexedDB = new IDBFactory()
    const db = await openDatabase()
    const saver = new Saver(db)
    const marked = (marker: string) => ({ ...emptyModel(), meta: { marker } })
    saver.save(marked('A: active'))
    saver.save(marked('B: pending'))
    const replacement = saver.replace(marked('C: imported'))
    saver.save(marked('D: stale state during restore'))
    await saver.flush()
    expect((await loadModel(db))?.meta.marker).toBe('C: imported')
    await replacement
    db.close()
  })

  it('rejects an import when ownership is lost while flushing', async () => {
    globalThis.indexedDB = new IDBFactory()
    const db = await openDatabase()
    const saver = new Saver(db)
    saver.save({ ...emptyModel(), meta: { marker: 'active' } })
    const replacement = saver.replace({ ...emptyModel(), meta: { marker: 'imported' } })
    saver.stop()
    await expect(replacement).rejects.toThrow(/ownership was lost/)
    expect((await loadModel(db))?.meta.marker).toBe('active')
    await expect(saver.replace(emptyModel())).rejects.toThrow(/ownership was lost/)
    db.close()
  })

  it('rejects a second import while a replacement is in progress', async () => {
    globalThis.indexedDB = new IDBFactory()
    const db = await openDatabase()
    const saver = new Saver(db)
    const replacement = saver.replace({ ...emptyModel(), meta: { marker: 'first' } })
    await expect(saver.replace(emptyModel())).rejects.toThrow(/already being restored/)
    await replacement
    expect((await loadModel(db))?.meta.marker).toBe('first')
    db.close()
  })

  it('rejects failed imports and allows later saves', async () => {
    globalThis.indexedDB = new IDBFactory()
    const db = await openDatabase()
    const saver = new Saver(db)
    const poisoned = { ...emptyModel(), meta: { fn: () => 1 } } as unknown as ReturnType<typeof emptyModel>
    await expect(saver.replace(poisoned)).rejects.toThrow()
    saver.save({ ...emptyModel(), meta: { marker: 'recovered' } })
    await saver.flush()
    expect((await loadModel(db))?.meta.marker).toBe('recovered')
    db.close()
  })

  it('drops queued and future saves after ownership is lost', async () => {
    globalThis.indexedDB = new IDBFactory()
    const db = await openDatabase()
    const saver = new Saver(db)
    const active = emptyModel()
    active.meta.marker = 'active transaction'
    saver.save(active)
    const pending = emptyModel()
    pending.meta.marker = 'stale pending write'
    saver.save(pending)
    saver.stop()
    saver.save(pending)
    await saver.flush()
    expect((await loadModel(db))?.meta.marker).toBe('active transaction')
    db.close()
  })

  it('stores and reloads the document', async () => {
    globalThis.indexedDB = new IDBFactory()
    const db = await openDatabase()
    expect(await loadModel(db)).toBeNull()
    const content = loadContent()
    const saver = new Saver(db)
    const store = new Store(null, () => 1789200000, (m) => saver.save(m))
    store.startSession()
    store.beginRound(content.passages['p-molecules'], 'test')
    store.beginRound(content.passages['p-molecules'], 'test')
    await saver.flush()
    const loaded = await loadModel(db)
    expect(loaded?.rounds.length).toBe(2)
    expect(loaded?.sessions.length).toBe(1)
    db.close()
  })

  it('rejects unknown schema versions instead of guessing', async () => {
    globalThis.indexedDB = new IDBFactory()
    const db = await openDatabase()
    await writeModel(db, { ...emptyModel(), schema_version: 99 })
    await expect(loadModel(db)).rejects.toThrow(/schema[ _]version/)
    db.close()
  })

  it('reports write failures without losing later saves', async () => {
    globalThis.indexedDB = new IDBFactory()
    const db = await openDatabase()
    const errors: Error[] = []
    const saver = new Saver(db, (e) => errors.push(e))
    // A document that cannot be cloned makes the put throw synchronously inside the transaction.
    const poisoned = { ...emptyModel(), meta: { fn: () => 1 } } as unknown as ReturnType<typeof emptyModel>
    saver.save(poisoned)
    const good = emptyModel()
    good.meta.ok = true
    saver.save(good)
    await saver.flush()
    expect((await loadModel(db))?.meta.ok).toBe(true)
    expect(errors).toHaveLength(1)
    expect(errors[0].name).toBe('DataCloneError')
    db.close()
  })
})
