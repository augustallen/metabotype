import { afterEach, describe, expect, it, vi } from 'vitest'
import { acquireOwnership, LOCK_NAME } from '../../src/storage/lock.ts'

afterEach(() => vi.unstubAllGlobals())

describe('history ownership', () => {
  it.each([false, true])('fails closed without Web Locks (takeover: %s)', async (steal) => {
    vi.stubGlobal('navigator', {})
    const channel = vi.fn()
    vi.stubGlobal('BroadcastChannel', channel)
    await expect(acquireOwnership({ steal, onLost: vi.fn() })).rejects.toThrow(/supports Web Locks/)
    expect(channel).not.toHaveBeenCalled()
  })

  it('reports a busy lock without waiting for the other tab to close', async () => {
    const request = vi.fn(async (_name, _options, callback) => callback(null))
    vi.stubGlobal('navigator', { locks: { request } })
    const lock = await acquireOwnership({ onLost: vi.fn() })
    expect(lock.acquired).toBe(false)
    expect(request).toHaveBeenCalledWith(LOCK_NAME, { ifAvailable: true }, expect.any(Function))
    lock.release()
  })

  it('holds ownership until released', async () => {
    let finished = false
    const request = vi.fn(async (_name, _options, callback) => {
      await callback({ name: LOCK_NAME })
      finished = true
    })
    vi.stubGlobal('navigator', { locks: { request } })
    const lost = vi.fn()
    const lock = await acquireOwnership({ onLost: lost })
    expect(lock.acquired).toBe(true)
    expect(finished).toBe(false)
    lock.release()
    await vi.waitFor(() => expect(finished).toBe(true))
    expect(lost).not.toHaveBeenCalled()
  })

  it('propagates request rejection so startup can report an error', async () => {
    const error = new DOMException('Permission denied', 'SecurityError')
    vi.stubGlobal('navigator', { locks: { request: vi.fn().mockRejectedValue(error) } })
    const lost = vi.fn()
    await expect(acquireOwnership({ onLost: lost })).rejects.toBe(error)
    expect(lost).not.toHaveBeenCalled()
  })

  it('reports takeover and releases the old callback', async () => {
    let abort!: (error: Error) => void
    let finished = false
    const request = vi.fn((_name, _options, callback) => {
      void callback({ name: LOCK_NAME }).then(() => { finished = true })
      return new Promise<void>((_resolve, reject) => { abort = reject })
    })
    vi.stubGlobal('navigator', { locks: { request } })
    const lost = vi.fn()
    const lock = await acquireOwnership({ steal: true, onLost: lost })
    expect(lock.acquired).toBe(true)
    expect(request).toHaveBeenCalledWith(LOCK_NAME, { steal: true }, expect.any(Function))
    abort(new DOMException('Lock stolen', 'AbortError'))
    await vi.waitFor(() => expect(lost).toHaveBeenCalledOnce())
    expect(finished).toBe(true)
  })
})
