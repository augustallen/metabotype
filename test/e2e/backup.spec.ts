import { expect, test, type Page } from '@playwright/test'
import { makeBackup } from '../../src/storage/backup.ts'
import { emptyModel, type Model } from '../../src/storage/model.ts'
import { readModel, seedModel } from './helpers.ts'

function fixture(marker: string): Model {
  const model = emptyModel()
  model.meta.marker = marker
  model.sessions.push({ id: `${marker}-session`, started: 1, ended: 2, app_version: 'test' })
  model.learning.foundations = { topic: 'foundations', level: 2, window: [], wrong_streak: 0, last_practiced: 1 }
  model.exposure['p-molecules'] = 1
  return model
}

async function shareResult(page: Page, cancel: boolean): Promise<void> {
  await page.addInitScript((cancelShare) => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => {
        if (cancelShare) throw new DOMException('The user canceled sharing', 'AbortError')
      },
    })
  }, cancel)
}

async function openData(page: Page): Promise<Model> {
  await seedModel(page, fixture('existing'))
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  await expect.poll(async () => (await readModel(page)).meta.marker).toBe('existing')
  await expect.poll(async () => (await readModel(page)).sessions.some((s) => s.ended === null)).toBe(true)
  await page.getByRole('button', { name: 'Data & backup' }).click()
  return readModel(page)
}

async function chooseBackup(page: Page, backup: unknown): Promise<void> {
  // pickFile uses a detached input, so target the browser's file chooser.
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Restore from backup…' }).click()
  await (await chooser).setFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
}

test.beforeEach(async ({}, info) => {
  test.skip(info.project.name === 'pixel' || info.project.name === 'iphone', 'Browser share and file chooser regressions')
})

test('canceling a backup share leaves the backup timestamp unset', async ({ page }) => {
  await shareResult(page, true)
  const before = await openData(page)
  expect(before.meta.last_backup).toBeUndefined()
  await page.getByRole('button', { name: 'Download backup (JSON)' }).click()
  await expect(page.getByRole('status')).toHaveText('Backup canceled.')
  expect(await readModel(page)).toEqual(before)
})

test('canceling CSV sharing reports cancellation and preserves history', async ({ page }) => {
  await shareResult(page, true)
  const before = await openData(page)
  for (const name of ['Export rounds (CSV)', 'Export question attempts (CSV)']) {
    await page.getByRole('button', { name }).click()
    await expect(page.getByRole('status')).toHaveText('Export canceled.')
  }
  expect(await readModel(page)).toEqual(before)
})

test('canceling the safety copy cancels restoration without reloading', async ({ page }) => {
  await shareResult(page, true)
  const before = await openData(page)
  page.on('dialog', (dialog) => dialog.accept())
  await page.evaluate(() => { document.documentElement.dataset.restoreTest = 'same-page' })
  await chooseBackup(page, makeBackup(fixture('imported')))
  await expect(page.getByRole('status')).toHaveText('Restore canceled. Your history has not changed.')
  await expect(page.locator('html')).toHaveAttribute('data-restore-test', 'same-page')
  expect(await readModel(page)).toEqual(before)
})

test('a malformed learning window is rejected before replacing history', async ({ page }) => {
  await shareResult(page, false)
  const before = await openData(page)
  const backup = makeBackup(fixture('invalid'))
  const malformed = { ...backup, model: { ...backup.model, learning: {
    foundations: { ...backup.model.learning.foundations, window: null },
  } } }
  const confirmations: string[] = []
  page.on('dialog', async (dialog) => { confirmations.push(dialog.message()); await dialog.dismiss() })
  await chooseBackup(page, malformed)
  await expect(page.getByRole('status')).toContainText('Could not read that file:')
  await expect(page.getByRole('status')).toContainText('learning.foundations.window')
  expect(confirmations).toEqual([])
  expect(await readModel(page)).toEqual(before)
})

test('a valid restore survives reload with imported history and a new session', async ({ page }) => {
  await shareResult(page, false)
  const before = await openData(page)
  const imported = fixture('imported')
  imported.learning.foundations.level = 3
  imported.exposure['p-molecules'] = 123
  page.on('dialog', (dialog) => dialog.accept())
  const reloaded = page.waitForEvent('load')
  await chooseBackup(page, makeBackup(imported))
  await reloaded
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  await expect.poll(async () => (await readModel(page)).meta.marker).toBe('imported')
  await expect.poll(async () => (await readModel(page)).sessions.length).toBe(imported.sessions.length + 1)
  const after = await readModel(page)
  expect(after.learning).toEqual(imported.learning)
  expect(after.exposure).toEqual(imported.exposure)
  expect(after.sessions).toContainEqual(imported.sessions[0])
  expect(after.sessions.filter((s) => s.ended === null)).toHaveLength(1)
  expect(after.sessions.some((s) => before.sessions.some((old) => old.id === s.id))).toBe(false)
})
