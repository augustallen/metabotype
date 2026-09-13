import { expect, test } from '@playwright/test'
import { emptyModel, type Model } from '../../src/storage/model.ts'
import { seedModel } from './helpers.ts'

function fixture(rounds: { started: number; wpm: number; topic?: string; scoring?: number }[], transitions: { created: number; level: number }[] = []): Model {
  const model = emptyModel()
  model.sessions.push({ id: 's', started: 0, ended: null, app_version: 'test' })
  rounds.forEach((r, i) => {
    model.rounds.push({
      id: `r${i}`, session_id: 's', topic: r.topic ?? 'foundations', concept: 'molecules', passage_id: 'p-molecules',
      passage_version: 1, started: r.started, completed: r.started + 60, status: 'complete', typing_status: 'complete',
      kind: 'practice', repeated: 0, reason: 'test',
      metrics: {
        active_duration: 60, target_count: 400, accepted_count: 400, first_correct: 400, attempted_count: 400,
        incorrect_attempts: 0, correct_attempts: 400, backspaces: 0, word_deletions: 0, deleted_characters: 0,
        period_shortcuts: 0, pending_attempts: 0, pause_duration: 0, best_combo: 400, wpm: r.wpm, accuracy: 100,
        scoring_version: r.scoring ?? 3, typing_mode: r.scoring ? 'correction-required' : 'editable-sentences', invalid: false,
      },
    })
  })
  transitions.forEach((t, i) => {
    model.transitions.push({ id: i + 1, topic: 'foundations', previous_level: 1, new_level: t.level, round_id: 'r0', reason: 'test', algorithm_version: 1, created: t.created })
  })
  return model
}

const now = Date.now() / 1000
const DAY = 86400

test('ranges cycle with the keyboard and survive reopening', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'Keyboard flow')
  await page.goto('/')
  await page.getByRole('button', { name: 'Field notebook' }).click()
  await expect(page.getByRole('tab', { name: '30 days', selected: true })).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('tab', { name: 'All time', selected: true })).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: '30 days', selected: true })).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: '1 year', selected: true })).toBeVisible()
  await page.keyboard.press('t')
  await expect(page.getByRole('tab', { name: 'The context detectives', selected: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Field notebook' }).click()
  await expect(page.getByRole('tab', { name: '1 year', selected: true })).toBeVisible()
  await expect(page.getByText('Play a round to begin')).toBeVisible()
  await expect(page.getByText('Answer a question to begin')).toBeVisible()
})

test('date axis includes years for long histories', async ({ page }) => {
  await seedModel(page, fixture(
    [{ started: now - 731 * DAY, wpm: 20 }, { started: now, wpm: 40 }],
    [{ created: now - 731 * DAY, level: 1 }, { created: now, level: 2 }],
  ))
  await page.getByRole('button', { name: 'Field notebook' }).click()
  await page.getByRole('tab', { name: 'All time' }).click()
  const labels = await page.locator('.chart-line .axis-dates text').allTextContents()
  expect(labels.length).toBe(3)
  expect(labels[0]).toMatch(/'\d\d$/)
  expect(labels[2]).toMatch(/'\d\d$/)
  await expect(page.getByText('40.0 WPM')).toBeVisible()
  await expect(page.getByText(/Latest day: \d{4}-\d{2}-\d{2}/)).toBeVisible()
  await expect(page.getByText('Level 2 of 4')).toBeVisible()
  await expect(page.getByText('Explain')).toBeVisible()
  await expect(page.getByText('points summarize intervals')).toBeVisible()
})

test('a single day shows one label and one marker', async ({ page }) => {
  await seedModel(page, fixture([{ started: now, wpm: 42 }]))
  await page.getByRole('button', { name: 'Field notebook' }).click()
  await page.getByRole('tab', { name: 'All time' }).click()
  await expect(page.locator('.chart-line .axis-dates text')).toHaveCount(1)
  await expect(page.locator('.chart-line .marker')).toHaveCount(1)
  await expect(page.getByText('42.0 WPM')).toBeVisible()
  await expect(page.getByText('Answer a question to begin')).toBeVisible()
})

test('earlier scoring rules stay readable but leave the trends', async ({ page }) => {
  await seedModel(page, fixture([{ started: now, wpm: 42, scoring: 1 }]))
  await page.getByRole('button', { name: 'Field notebook' }).click()
  await expect(page.getByText('No scores yet')).toBeVisible()
  await page.getByRole('button', { name: 'Recent rounds' }).click()
  await expect(page.getByText('42.0')).toBeVisible()
  await expect(page.getByText('earlier typing rules')).toBeVisible()
})

test('data screen exports and reports storage', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'Download flow')
  await seedModel(page, fixture([{ started: now, wpm: 42 }]))
  await page.getByRole('button', { name: 'Data & backup' }).click()
  await expect(page.getByText('1 rounds on this device')).toBeVisible()
  let download = page.waitForEvent('download')
  await page.getByRole('button', { name: /Export rounds/ }).click()
  expect((await download).suggestedFilename()).toMatch(/^metabotype-rounds-/)
  download = page.waitForEvent('download')
  await page.getByRole('button', { name: /Export question attempts/ }).click()
  expect((await download).suggestedFilename()).toMatch(/^metabotype-question-attempts-/)
  const backup = page.waitForEvent('download')
  await page.getByRole('button', { name: /Download backup/ }).click()
  expect((await backup).suggestedFilename()).toMatch(/^metabotype-backup-/)
})
