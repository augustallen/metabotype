import { readFileSync } from 'node:fs'
import { Content, ContentError } from '../src/core/content.ts'

try {
  const content = new Content(JSON.parse(readFileSync(new URL('../content/curriculum.json', import.meta.url), 'utf8')))
  const counts = [content.topics, content.passages, content.questions].map((x) => Object.keys(x).length)
  console.log(`Content valid: ${counts[0]} topics, ${counts[1]} passages, ${counts[2]} questions.`)
  console.log('Structural validation passed. Scientific correctness and difficulty also need human review.')
} catch (error) {
  if (error instanceof ContentError) {
    console.error(`Content invalid: ${error.message}`)
    process.exit(1)
  }
  throw error
}
