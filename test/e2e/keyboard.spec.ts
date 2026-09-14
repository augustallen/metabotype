import { expect, test } from '@playwright/test'
import { begin, readModel, roundById, typeText } from './helpers.ts'

test.beforeEach(async ({}, info) => {
  test.skip(info.project.name === 'pixel' || info.project.name === 'iphone', 'Desktop keyboard navigation')
})

for (const key of ['Enter', 'p', 'ArrowDown'] as const) {
  test(`fresh load accepts ${key} without a click`, async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Play' })).toBeFocused()
    await page.keyboard.press(key)
    if (key === 'ArrowDown') {
      await expect(page.getByRole('button', { name: 'Topics' })).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('heading', { name: 'Topics', exact: true })).toBeVisible()
    } else {
      await expect(page.getByTestId('passage')).toBeVisible()
      await expect(page.getByRole('textbox', { name: 'Type the passage' })).toBeFocused()
    }
  })
}

test('home recovers keyboard focus restored to the inactive typing field on load', async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => document.getElementById('typing-field')?.focus())
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Play' })).toBeFocused()
  await page.keyboard.press('h')
  await expect(page.getByRole('heading', { name: 'Field notebook', exact: true })).toBeVisible()
})

test('Enter activates the focused home control and help restores focus', async ({ page }) => {
  await page.goto('/')
  const data = page.getByRole('button', { name: 'Data & backup' })
  await data.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Data & backup' })).toBeVisible()
  await expect(page.getByTestId('passage')).toHaveCount(0)

  await page.keyboard.press('Escape')
  const help = page.getByRole('button', { name: 'Help', exact: true })
  await help.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Help' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: /Close/ })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(help).toBeFocused()
})

test('notebook Tab navigates without changing topics and Enter activates a tab', async ({ page }, info) => {
  // Safari on macOS uses Option+Tab to include buttons in native page navigation.
  const tab = info.project.name === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab'
  await page.goto('/')
  await page.getByRole('button', { name: 'Field notebook' }).click()
  const topics = page.getByRole('tablist', { name: 'Topic', exact: true }).getByRole('tab')
  await topics.nth(0).focus()
  await page.keyboard.press(tab)
  await expect(topics.nth(1)).toBeFocused()
  await expect(topics.nth(0)).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(topics.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'Field notebook' })).toBeVisible()
  await page.keyboard.press(`Shift+${tab}`)
  await expect(topics.nth(0)).toBeFocused()
  await expect(topics.nth(1)).toHaveAttribute('aria-selected', 'true')
})

test('pause sheet keeps Tab inside and Enter activates Leave round', async ({ page }) => {
  await begin(page)
  await page.keyboard.press('Escape')
  const dialog = page.getByRole('dialog', { name: 'Paused' })
  const resume = dialog.getByRole('button', { name: /Resume/ })
  const leave = dialog.getByRole('button', { name: /Leave round/ })
  await expect(resume).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Help', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(leave).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(resume).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(leave).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible()
  await expect(page.getByTestId('passage')).toHaveCount(0)
})

test('home focus follows Tab and rapid arrows before Enter', async ({ page }, info) => {
  const tab = info.project.name === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab'
  await page.goto('/')
  await page.getByRole('button', { name: 'Play' }).focus()
  await page.keyboard.press(tab)
  const topics = page.getByRole('button', { name: 'Topics' })
  await expect(topics).toBeFocused()
  await expect(topics).toHaveClass(/selected/)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Field notebook', exact: true })).toBeVisible()
  await expect(page.getByTestId('passage')).toHaveCount(0)
})

test('topic focus follows Tab and rapid arrows start the focused topic', async ({ page }, info) => {
  const tab = info.project.name === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab'
  await page.goto('/')
  await page.getByRole('button', { name: 'Topics' }).click()
  const topics = page.locator('.cards button')
  await topics.nth(0).focus()
  await page.keyboard.press(tab)
  await expect(topics.nth(1)).toBeFocused()
  await expect(topics.nth(1)).toHaveClass(/selected/)
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('passage')).toBeVisible()
  await expect.poll(async () => (await readModel(page)).rounds.at(-1)?.topic).toBe('foundations')
})

for (const method of ['click', 'number', 'arrows', 'focus'] as const) {
  test(`quiz ${method} selection confirms the intended answer with Enter`, async ({ page }) => {
    const { rid, text } = await begin(page)
    await typeText(page, text, 'insert')
    await expect(page.getByRole('heading', { name: 'Question', exact: true })).toBeVisible()
    const options = page.getByRole('radio')
    const { question } = await roundById(page, rid)
    const order = question!.option_order
    let index = 1
    if (method === 'click') {
      await options.nth(index).click()
    } else if (method === 'number') {
      await options.nth(0).focus()
      await page.keyboard.press('1')
      await page.keyboard.press('2')
    } else if (method === 'arrows') {
      await page.keyboard.press('ArrowUp')
      await expect(options.last()).toBeFocused()
      await expect(options.last()).toHaveAttribute('aria-checked', 'true')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowLeft')
      await page.keyboard.press('ArrowDown')
    } else {
      index = 0
      await options.nth(1).click()
      await options.nth(index).focus()
    }
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Next round' })).toBeVisible()
    await expect.poll(async () => (await roundById(page, rid)).question?.selected).toBe(order[index])
    await expect.poll(async () => (await roundById(page, rid)).round.status).toBe('complete')
  })
}
