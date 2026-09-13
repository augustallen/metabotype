import { chromium, devices } from '@playwright/test'
import { readFileSync } from 'node:fs'
const out = '/tmp/claude-1000/-home-gazelle-Projects/1d064921-929f-4b63-8e0d-b736e1ba63d6/scratchpad/shots'
const curriculum = JSON.parse(readFileSync('content/curriculum.json', 'utf8'))
const passages = Object.fromEntries(curriculum.passages.map(p => [p.id, p]))
const questions = Object.fromEntries(curriculum.questions.map(q => [q.id, q]))
const readModel = (page) => page.evaluate(() => new Promise((resolve) => { const req = indexedDB.open('metabotype', 1); req.onsuccess = () => { const db = req.result; const g = db.transaction('documents').objectStore('documents').get('history'); g.onsuccess = () => { db.close(); resolve(g.result) } } }))
const browser = await chromium.launch()
for (const [label, opts] of [['phone', { ...devices['Pixel 7'] }], ['desktop', { viewport: { width: 1200, height: 800 } }]]) {
  const ctx = await browser.newContext(opts)
  const page = await ctx.newPage()
  const shot = (name) => page.screenshot({ path: `${out}/${label}-${name}.png` })
  await page.goto('http://localhost:4173/')
  await page.getByRole('button', { name: 'Play' }).waitFor()
  await shot('01-home')
  await page.getByRole('button', { name: 'Topics' }).click(); await page.waitForTimeout(400); await shot('02-topics')
  await page.getByRole('button', { name: 'Back' }).click(); await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Play' }).click()
  await page.getByText(/Sentence 1 of/).waitFor()
  const model = await readModel(page)
  const round = [...model.rounds].sort((a, b) => b.started - a.started)[0]
  const text = passages[round.passage_id].text
  await page.keyboard.type(text.slice(0, 12)); await page.keyboard.type('x'); await page.waitForTimeout(200); await shot('03-typing-error')
  await page.keyboard.press('Backspace'); await page.keyboard.type(text.slice(12, 40)); await page.waitForTimeout(1100); await shot('04-typing')
  await page.keyboard.press('Escape'); await page.waitForTimeout(400); await shot('05-pause')
  await page.keyboard.press('Enter'); await page.keyboard.type(text.slice(40))
  await page.getByRole('heading', { name: 'Question' }).waitFor(); await page.waitForTimeout(300); await shot('06-quiz')
  const m2 = await readModel(page); const qa = m2.questions.find(q => q.round_id === round.id); const q = questions[qa.question_id]
  await page.getByRole('radio').nth(qa.option_order.indexOf(q.correct)).click(); await page.waitForTimeout(200); await shot('07-quiz-selected')
  await page.getByRole('button', { name: 'Confirm' }).click(); await page.waitForTimeout(700); await shot('08-results')
  await page.getByRole('button', { name: 'Details' }).click(); await page.waitForTimeout(400); await shot('09-details')
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Home' }).click(); await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Field notebook' }).click(); await page.waitForTimeout(500); await shot('10-notebook')
  await page.getByRole('button', { name: 'Recent rounds' }).click(); await page.waitForTimeout(400); await shot('11-rounds')
  await page.getByRole('button', { name: 'Back' }).click(); await page.getByRole('button', { name: 'Back' }).click(); await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Data & backup' }).click(); await page.waitForTimeout(500); await shot('12-data')
  await page.getByRole('button', { name: 'Home' }).click(); await page.getByRole('button', { name: 'Help' }).click(); await page.waitForTimeout(400); await shot('13-help')
  await ctx.close()
}
await browser.close()
console.log('done')
