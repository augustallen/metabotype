/** Pair a useful passage with an eligible question before a round starts. Port of cli/src/metabotype/practice.py. */
import type { Content, Passage, Question } from './content.ts'
import { DAY, type LearningState } from './learning.ts'
import type { Rng } from './rng.ts'
import type { EvidenceKind, Review } from '../storage/model.ts'

export interface Recommendation {
  passage: Passage
  question: Question
  reason: string
  evidenceKind: EvidenceKind
  review: boolean
}

/** The slice of history that recommendations read. */
export interface RecommendSource {
  clock: () => number
  questionSeen(): Map<string, number>
  encountered(): Set<string>
  reviews(dueOnly?: boolean): Review[]
  rounds(): { passage_id: string; typing_status: string }[]
  state(topic: string): LearningState
  lastTopic(): string | null
}

export interface RecommendOptions { topic?: string | null; concept?: string | null; reviewStreak?: number; rng?: Rng }

type Score = number[]

function compare(a: Score, b: Score): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

export function recommend(content: Content, storage: RecommendSource, options: RecommendOptions = {}): Recommendation {
  const { topic = null, concept = null, reviewStreak = 0 } = options
  const rng = options.rng ?? Math.random
  const seen = storage.questionSeen()
  const encountered = storage.encountered()
  const now = storage.clock()
  const due = storage.reviews(true)
  const passageCounts = new Map<string, number>()
  for (const r of storage.rounds()) {
    if (r.typing_status === 'complete') passageCounts.set(r.passage_id, (passageCounts.get(r.passage_id) ?? 0) + 1)
  }
  const current = topic || storage.lastTopic() || Object.keys(content.topics)[0]
  const candidates: [Score, Recommendation][] = []
  for (const q of Object.values(content.questions)) {
    if ((topic && q.topic !== topic) || (concept && q.concept !== concept)) continue
    const state = storage.state(q.topic)
    if (q.level !== state.level) continue
    for (const pid of q.passages) {
      const p = content.passages[pid]
      if (!p.prerequisites.every((c) => encountered.has(c))) continue
      if (!q.prerequisites.every((c) => encountered.has(c) || p.concepts.includes(c))) continue
      const last = seen.get(q.id)
      // Retention evidence is explicitly labeled, never passed off as unseen.
      const kind: EvidenceKind = last === undefined ? 'fresh' : now - last >= DAY ? 'reassessment' : 'review'
      const review = due.find((r) => r.concept === q.concept) ?? null
      let priority = review && review.stage === 0 ? 0 : review ? 1 : 2
      if (reviewStreak >= 2 && !concept && review) priority = 3
      if (kind === 'review') priority += 5
      const used = state.window.some((x) => x[0] === q.id)
      const score: Score = [
        priority, Number(q.topic !== current), Number(kind !== 'fresh'), Number(used),
        Number(encountered.has(p.concepts[0])), passageCounts.get(pid) ?? 0, last ?? 0,
        // Equally useful rounds are drawn at random, so a new game doesn't always open the same way.
        rng(),
      ]
      let reason = review && review.stage === 0 ? 'Rebuild a missed concept' : review ? 'A retention check is due' : 'Explore this topic'
      if (kind === 'review') reason = 'Bank explored: review only; reassess after 24 hours or try another topic'
      else if (kind === 'reassessment') reason += ' / delayed reassessment (seen before)'
      candidates.push([score, { passage: p, question: q, reason, evidenceKind: kind, review: Boolean(review) }])
    }
  }
  if (!candidates.length) throw new Error('No eligible lessons. Choose another topic.')
  let best = candidates[0]
  for (const candidate of candidates) if (compare(candidate[0], best[0]) < 0) best = candidate
  return best[1]
}
