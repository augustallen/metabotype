import { expect, test } from '@playwright/test'
import { readModel } from './helpers.ts'

test('simultaneous tabs acquire only one writer', async ({ page, context }) => {
  const other = await context.newPage()
  await Promise.all([page.goto('/'), other.goto('/')])
  await expect.poll(async () => {
    const players = await Promise.all([page, other].map((tab) => tab.getByRole('button', { name: 'Play' }).count()))
    const waiting = await Promise.all([page, other].map((tab) => tab.getByRole('heading', { name: 'Open elsewhere' }).count()))
    return [players.reduce((a, b) => a + b), waiting.reduce((a, b) => a + b)]
  }).toEqual([1, 1])
  await other.close()
})

test('without Web Locks startup explains unsupported ownership and never opens history', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', { value: undefined })
    indexedDB.open = () => { throw new Error('History must not be opened without ownership') }
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: "Metabotype can't start" })).toBeVisible()
  await expect(page.getByText(/supports Web Locks/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Open elsewhere' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Play' })).toHaveCount(0)
})

test('a failed history load releases ownership for another tab', async ({ page, context }) => {
  await page.addInitScript(() => {
    indexedDB.open = () => { throw new Error('Storage blocked for test') }
  })
  await page.goto('/')
  await expect(page.getByText(/Storage blocked for test/)).toBeVisible()
  const other = await context.newPage()
  await other.goto('/')
  await expect(other.getByRole('button', { name: 'Play' })).toBeVisible()
  await other.close()
})

test('takeover while history is loading never starts a stale session', async ({ page, context }) => {
  await page.addInitScript(() => {
    const open = indexedDB.open.bind(indexedDB)
    indexedDB.open = (...args) => {
      const request = open(...args)
      request.addEventListener('success', (event) => {
        event.stopImmediatePropagation()
        ;(window as typeof window & { resumeHistoryOpen: () => void }).resumeHistoryOpen = () => {
          request.onsuccess?.call(request, event)
        }
      })
      return request
    }
  })
  await page.goto('/')
  await expect.poll(() => page.evaluate(() => typeof (window as typeof window & { resumeHistoryOpen?: () => void }).resumeHistoryOpen)).toBe('function')
  const other = await context.newPage()
  await other.goto('/')
  await expect(other.getByRole('heading', { name: 'Open elsewhere' })).toBeVisible()
  await other.getByRole('button', { name: 'Use it here' }).click()
  await expect(other.getByRole('button', { name: 'Play' })).toBeVisible()
  await page.evaluate(() => (window as typeof window & { resumeHistoryOpen: () => void }).resumeHistoryOpen())
  await expect(page.getByText('Another tab took over')).toBeVisible()
  expect((await readModel(other)).sessions).toHaveLength(1)
  await other.close()
})
