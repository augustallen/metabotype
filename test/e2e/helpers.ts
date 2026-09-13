import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import type { Curriculum } from '../../src/core/content.ts'
import type { Model } from '../../src/storage/model.ts'

const curriculum = JSON.parse(readFileSync(new URL('../../content/curriculum.json', import.meta.url), 'utf8')) as Curriculum

export const passages = Object.fromEntries(curriculum.passages.map((p) => [p.id, p]))
export const questions = Object.fromEntries(curriculum.questions.map((q) => [q.id, q]))

/** Read the whole history document straight out of IndexedDB. */
export function readModel(page: Page): Promise<Model> {
  return page.evaluate(() => new Promise<Model>((resolve, reject) => {
    const req = indexedDB.open('metabotype', 1)
    req.onsuccess = () => {
      const db = req.result
      const get = db.transaction('documents').objectStore('documents').get('history')
      get.onsuccess = () => { db.close(); resolve(get.result) }
      get.onerror = () => reject(get.error)
    }
    req.onerror = () => reject(req.error)
  }))
}

export async function seedModel(page: Page, model: Model): Promise<void> {
  await page.goto('/')
  await page.evaluate((doc) => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('metabotype', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('documents')
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('documents', 'readwrite')
      tx.objectStore('documents').put(doc, 'history')
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => reject(tx.error)
    }
    req.onerror = () => reject(req.error)
  }), model)
  await page.reload()
}

/** Press Play and return the round that started, with its passage text. */
export async function begin(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Play' }).click()
  await page.getByText(/Sentence 1 of/).waitFor()
  const model = await readModel(page)
  const round = [...model.rounds].sort((a, b) => b.started - a.started)[0]
  const passage = passages[round.passage_id]
  return { rid: round.id, passage, text: passage.text }
}

export async function typeText(page: Page, text: string, mode: 'keys' | 'insert' = 'keys') {
  if (mode === 'keys') await page.keyboard.type(text)
  else {
    // Insert word by word like a phone keyboard commits text, without keydown events; keep every space.
    for (const chunk of text.split(/(?<=\s)(?=\S)/)) await page.keyboard.insertText(chunk)
  }
}

export async function roundById(page: Page, rid: string) {
  const model = await readModel(page)
  return { round: model.rounds.find((r) => r.id === rid)!, question: model.questions.find((q) => q.round_id === rid) }
}

export function firstSentence(text: string): string {
  return text.split(/(?<=[.!?]) +/)[0]
}
