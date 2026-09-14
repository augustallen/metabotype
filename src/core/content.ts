/** Load and validate the offline, versioned curriculum. Port of cli/src/metabotype/content.py. */

export class ContentError extends Error {}

export interface Topic { id: string; title: string; subtitle: string; number: string }
export interface Source { id: string; title: string; url: string; author: string; license: string }
export interface Passage {
  id: string; version: number; title: string; topic: string; concepts: string[]
  prerequisites: string[]; text: string; sources: string[]
}
export interface Option { id: string; text: string; explanation: string }
export interface Question {
  id: string; version: number; topic: string; concept: string; level: number; prompt: string
  options: Option[]; correct: string; explanation: string; prerequisites: string[]
  sources: string[]; passages: string[]
}
export interface Curriculum {
  version: number; reviewed: string; review_note: string
  topics: Topic[]; sources: Source[]; passages: Passage[]; questions: Question[]
}

export class Content {
  data: Curriculum
  topics: Record<string, Topic>
  passages: Record<string, Passage>
  questions: Record<string, Question>

  constructor(data: unknown) {
    this.data = data as Curriculum
    this.validate()
    this.topics = Object.fromEntries(this.data.topics.map((x) => [x.id, x]))
    this.passages = Object.fromEntries(this.data.passages.map((x) => [x.id, x]))
    this.questions = Object.fromEntries(this.data.questions.map((x) => [x.id, x]))
  }

  validate(): void {
    const require = (ok: unknown, message: string) => {
      if (!ok) throw new ContentError(message)
    }
    const subset = (a: string[], b: Set<string>) => a.every((x) => b.has(x))
    try {
      const data = this.data
      require(data.version === 1, 'Unsupported content format')
      for (const name of ['topics', 'passages', 'questions', 'sources'] as const) {
        const items = data[name] as { id: string }[]
        require(items.length && new Set(items.map((x) => x.id)).size === items.length, `Duplicate or missing ${name} IDs`)
      }
      const topics = new Set(data.topics.map((x) => x.id))
      const passages = Object.fromEntries(data.passages.map((x) => [x.id, x]))
      const concepts = new Set(data.passages.flatMap((p) => p.concepts))
      const sources = new Set(data.sources.map((x) => x.id))
      for (const p of Object.values(passages)) {
        require(topics.has(p.topic), `Unknown topic in ${p.id}`)
        require(p.version >= 1 && p.concepts.length, `Missing metadata in ${p.id}`)
        const words = p.text.trim().split(/\s+/).length
        require(words >= 50 && words <= 90, `Passage ${p.id} must have 50-90 words`)
        require([...p.text].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126), `Non-ASCII text: ${p.id}`)
        require(p.sources.length && subset(p.sources, sources), `Invalid sources: ${p.id}`)
        require(subset(p.prerequisites, concepts), `Unknown prerequisites: ${p.id}`)
      }
      const reached = new Set<string>()
      for (;;) {
        const before = reached.size
        for (const p of Object.values(passages)) {
          if (subset(p.prerequisites, reached)) p.concepts.forEach((c) => reached.add(c))
        }
        if (reached.size === before) break
      }
      require(reached.size === concepts.size && [...concepts].every((c) => reached.has(c)), 'Unreachable passage prerequisites')
      for (const q of data.questions) {
        const label = q.id
        const opts = q.options
        require(topics.has(q.topic) && [1, 2, 3, 4].includes(q.level), `Invalid topic/level: ${label}`)
        require(concepts.has(q.concept) && q.version >= 1, `Invalid metadata: ${label}`)
        require(opts.length >= 3 && opts.length <= 4 && new Set(opts.map((o) => o.id)).size === opts.length, `Invalid options: ${label}`)
        require(opts.some((o) => o.id === q.correct), `Missing correct option: ${label}`)
        require(opts.every((o) => o.explanation) && q.explanation, `Missing explanation: ${label}`)
        require(subset(q.prerequisites, concepts), `Unknown prerequisites: ${label}`)
        require(q.sources.length && subset(q.sources, sources), `Invalid sources: ${label}`)
        require(q.passages.length && q.passages.every((pid) => pid in passages), `Unknown passage: ${label}`)
        for (const pid of q.passages) {
          const p = passages[pid]
          require(p.topic === q.topic && p.concepts.includes(q.concept), `Incompatible passage: ${label}`)
          require(subset(q.prerequisites, reached), `Unreachable question: ${label}`)
        }
      }
      for (const topic of topics) {
        require(Object.values(passages).filter((p) => p.topic === topic).length >= 5, `Too few passages: ${topic}`)
        for (const level of [1, 2, 3, 4]) {
          const qs = data.questions.filter((q) => q.topic === topic && q.level === level)
          require(qs.length >= 10, `Need ten questions for ${topic} level ${level}`)
        }
      }
      for (const c of concepts) {
        for (const level of [1, 2, 3, 4]) {
          require(data.questions.filter((q) => q.concept === c && q.level === level).length >= 2,
            `Need alternate question for ${c} level ${level}`)
        }
      }
    } catch (exc) {
      if (exc instanceof ContentError) throw exc
      throw new ContentError(`Malformed content: ${(exc as Error).message}`)
    }
  }
}
