import { expect, test, type Page } from '@playwright/test'
import { begin, typeText } from './helpers.ts'

/** Observe feedback at the next frame, before an old 150-220 ms selection fade could finish. */
async function arrowFeedback(page: Page, key: string, selector: string) {
  return page.evaluate(async ({ key, selector }) => {
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    return Array.from(document.querySelectorAll(selector)).flatMap((el) => {
      // Resolve styles to create any pending CSS transitions before inspecting them.
      void getComputedStyle(el).borderColor
      return el.getAnimations().map((animation) => (animation as CSSTransition).transitionProperty)
        .filter((property) => ['border-bottom-color', 'border-top-color', 'border-left-color', 'border-right-color',
          'border-color', 'background-color', 'color', 'left'].includes(property))
    })
  }, { key, selector })
}

test('arrow selection feedback is immediate with motion enabled', async ({ page }, info) => {
  test.skip(info.project.name === 'pixel' || info.project.name === 'iphone', 'Physical keyboard feedback')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/')
  await page.getByRole('button', { name: 'Play' }).waitFor()
  expect(await arrowFeedback(page, 'ArrowDown', '.menu-item')).toEqual([])
  await expect(page.getByRole('button', { name: 'Topics', exact: false })).toHaveClass(/selected/)

  await page.getByRole('button', { name: 'Field notebook' }).click()
  await page.getByRole('heading', { name: 'Field notebook' }).waitFor()
  expect(await arrowFeedback(page, 'ArrowRight', '.segmented button, .segmented .pill')).toEqual([])
  await expect(page.getByRole('tab', { name: '90 days' })).toHaveAttribute('aria-selected', 'true')

  const { text } = await begin(page)
  await typeText(page, text)
  await page.getByRole('heading', { name: 'Question', exact: true }).waitFor()
  expect(await arrowFeedback(page, 'ArrowDown', '.option')).toEqual([])
  await expect(page.getByRole('radio').first()).toHaveAttribute('aria-checked', 'true')
})
