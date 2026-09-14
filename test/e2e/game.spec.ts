import { expect, test } from '@playwright/test'
import { begin, firstSentence, questions, readModel, roundById, typeText } from './helpers.ts'

const mobile = (name: string) => name === 'pixel' || name === 'iphone'

test('complete round, results, and notebook', async ({ page }, info) => {
  const { rid, text } = await begin(page)
  const mode = mobile(info.project.name) ? 'insert' : 'keys'
  await typeText(page, text[0], mode)
  await page.waitForTimeout(60)
  await typeText(page, text.slice(1), mode)
  await expect(page.getByRole('heading', { name: 'Question' })).toBeVisible()
  const { round, question } = await roundById(page, rid)
  expect(round.status).toBe('quiz')
  expect(round.metrics?.accuracy).toBe(100)
  expect(round.metrics?.accepted_count).toBe(text.length)
  const q = questions[question!.question_id]
  const correctIndex = question!.option_order.indexOf(q.correct)
  await page.getByRole('radio').nth(correctIndex).click()
  await page.getByRole('button', { name: 'Confirm' }).click()
  await expect(page.getByRole('heading', { name: 'Correct!' })).toBeVisible()
  await expect(page.getByText(/WPM/).first()).toBeVisible()
  await expect(page.getByText('saved')).toHaveCount(0)
  const after = await roundById(page, rid)
  expect(after.round.status).toBe('complete')
  expect(after.question?.outcome).toBe('correct')
  await page.getByRole('button', { name: 'Home' }).click()
  await page.getByRole('button', { name: 'Field notebook' }).click()
  await expect(page.getByText('TYPING / daily medians')).toBeVisible()
  await expect(page.getByText('UNDERSTANDING')).toBeVisible()
  await expect(page.getByText('Level 1 of 4')).toBeVisible()
})

test('paste cannot score the round', async ({ page, context }, info) => {
  const { rid, text } = await begin(page)
  if (info.project.name === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.evaluate((t) => navigator.clipboard.writeText(t), text)
    await page.keyboard.press('ControlOrMeta+v')
  } else {
    await page.locator('#typing-field').evaluate((el, t) => {
      const data = new DataTransfer()
      data.setData('text/plain', t)
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    }, text)
  }
  await expect(page.getByRole('heading', { name: 'Paste detected' })).toBeVisible()
  const { round } = await roundById(page, rid)
  expect(round.status).toBe('aborted')
  expect(round.metrics?.invalid).toBe(true)
  expect(round.metrics?.wpm).toBeNull()
})

test('escape pauses and resumes promptly, excluding paused time', async ({ page }, info) => {
  test.skip(mobile(info.project.name), 'Desktop keyboard flow')
  const { rid, text } = await begin(page)
  await page.keyboard.type(text[0])
  let pressed = Date.now()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible()
  expect(Date.now() - pressed).toBeLessThan(1000)
  await page.keyboard.type('XYZ')
  await page.waitForTimeout(200)
  pressed = Date.now()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Paused' })).toHaveCount(0)
  expect(Date.now() - pressed).toBeLessThan(1000)
  await page.keyboard.type(text.slice(1))
  await expect(page.getByRole('heading', { name: 'Question' })).toBeVisible()
  const { round } = await roundById(page, rid)
  expect(round.metrics?.incorrect_attempts).toBe(0)
  expect(round.metrics?.pause_duration).toBeGreaterThan(0.15)
  expect(round.typing_status).toBe('complete')
})

test('reload during the quiz recovers the completed typing', async ({ page }, info) => {
  const { rid, text } = await begin(page)
  await typeText(page, text, mobile(info.project.name) ? 'insert' : 'keys')
  await expect(page.getByRole('heading', { name: 'Question' })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Recovered 1 unfinished round')).toBeVisible()
  const { round, question } = await roundById(page, rid)
  expect([round.status, round.typing_status]).toEqual(['interrupted', 'complete'])
  expect(question?.outcome).toBe('unanswered')
})

test('separator space advances and saves a checkpoint', async ({ page }, info) => {
  const { rid, text } = await begin(page)
  const first = firstSentence(text)
  const mode = mobile(info.project.name) ? 'insert' : 'keys'
  await typeText(page, first, mode)
  expect((await roundById(page, rid)).round.metrics).toBeNull()
  await typeText(page, ' ', mode)
  await expect(page.getByText('Sentence 2 of')).toBeVisible()
  const { round } = await roundById(page, rid)
  expect(round.status).toBe('typing')
  expect(round.metrics?.accepted_count).toBe(first.length + 1)
})

for (const chord of ['Alt+Backspace', 'Control+Backspace']) {
  test(`backspace and ${chord} repair real input`, async ({ page }, info) => {
    test.skip(mobile(info.project.name), 'Desktop keyboard flow')
    const { rid, text } = await begin(page)
    const prefix = text.split(' ', 1)[0] + ' '
    await page.keyboard.type('x')
    await page.keyboard.press('Backspace')
    await page.keyboard.type(prefix + 'wrong')
    await expect(page.getByText('Backspace to fix')).toBeVisible()
    // The game owns this chord, so it deletes a word on every OS and browser.
    await page.keyboard.press(chord)
    await page.keyboard.type(text.slice(prefix.length))
    await expect(page.getByRole('heading', { name: 'Question' })).toBeVisible()
    const m = (await roundById(page, rid)).round.metrics!
    expect(m.backspaces).toBe(1)
    expect(m.word_deletions).toBe(1)
    expect(m.deleted_characters).toBe(6)
    expect(m.accepted_count).toBe(text.length)
    expect(m.accuracy).toBeLessThan(100)
  })
}

test('double-space shortcut completes the round without mistakes', async ({ page }, info) => {
  const { rid, text } = await begin(page)
  const shortcut = text.replace(/\.( +|$)/g, '  ')
  await typeText(page, shortcut, mobile(info.project.name) ? 'insert' : 'keys')
  await expect(page.getByRole('heading', { name: 'Question' })).toBeVisible()
  const m = (await roundById(page, rid)).round.metrics!
  expect(m.accepted_count).toBe(text.length)
  expect(m.accuracy).toBe(100)
  expect(m.incorrect_attempts).toBe(0)
  expect(m.period_shortcuts).toBeGreaterThan(1)
})

test("a phone keyboard's automatic period counts as the second space", async ({ page }, info) => {
  test.skip(!mobile(info.project.name), 'Phone keyboards only')
  const { rid, text } = await begin(page)
  const field = page.locator('#typing-field')
  // Emulate iOS: after "word " a second space becomes ". " inside the field.
  const sentences = text.split(/(?<=\.) +/)
  for (const [i, sentence] of sentences.entries()) {
    const body = sentence.replace(/\.$/, '')
    await page.keyboard.insertText(body + ' ')
    await field.evaluate((el: HTMLInputElement) => {
      el.value = el.value.replace(/ $/, '. ')
      el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: ' ', bubbles: true }))
    })
    if (i < sentences.length - 1) await expect(page.getByText(`Sentence ${i + 2} of`)).toBeVisible()
  }
  await expect(page.getByRole('heading', { name: 'Question' })).toBeVisible()
  const m = (await roundById(page, rid)).round.metrics!
  expect(m.accuracy).toBe(100)
  expect(m.period_shortcuts).toBe(sentences.length)
  expect(m.input_method).toBe('keyboard') // no virtual keyboard was seen in emulation
})

test('a second tab is told to wait, and can take over', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  const other = await context.newPage()
  await other.goto('/')
  await expect(other.getByRole('heading', { name: 'Open elsewhere' })).toBeVisible()
  await other.getByRole('button', { name: 'Use it here' }).click()
  await expect(other.getByRole('button', { name: 'Play' })).toBeVisible()
  await expect(page.getByText('Another tab took over')).toBeVisible()
  await other.close()
})

test('offline after the first visit still plays', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'chromium', 'Service worker check runs once')
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.waitForTimeout(1500)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.getByText(/Sentence 1 of/)).toBeVisible()
  await context.setOffline(false)
})

test('narrow screens never scroll sideways and render every character', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  const { text } = await begin(page)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  const rendered = await page.getByTestId('passage').evaluate((el) => el.textContent)
  expect(rendered).toBe(firstSentence(text) + ' ')
  const model = await readModel(page)
  expect(model.rounds.length).toBe(1)
})
