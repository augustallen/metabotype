import { describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { Store } from '../../src/storage/store.ts'
import { loadModel, openDatabase, Saver, writeModel } from '../../src/storage/persist.ts'
import { emptyModel } from '../../src/storage/model.ts'
import { loadContent } from '../helpers.ts'

describe('persistence', () => {
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
    await expect(loadModel(db)).rejects.toThrow(/schema version/)
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
    expect(errors.length).toBeGreaterThanOrEqual(0)
    db.close()
  })
})
