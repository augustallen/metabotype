"""Pair a useful passage with an eligible question before a round starts."""
from dataclasses import dataclass
from collections import Counter
import random

from .learning import DAY


@dataclass
class Recommendation:
    passage: dict
    question: dict
    reason: str
    evidence_kind: str
    review: bool = False


def recommend(content, storage, topic=None, concept=None, review_streak=0, rng=None):
    rng = rng or random.Random()
    seen = storage.question_seen()
    encountered = storage.encountered()
    now = storage.clock()
    due = storage.reviews(due_only=True)
    passage_counts = Counter(r["passage_id"] for r in storage.rounds() if r["typing_status"] == "complete")
    current = topic
    if not current:
        last = storage.db.execute("SELECT topic FROM learning ORDER BY last_practiced DESC LIMIT 1").fetchone()
        current = last[0] if last else next(iter(content.topics))
    candidates = []
    for q in content.questions.values():
        if topic and q["topic"] != topic or concept and q["concept"] != concept:
            continue
        state = storage.state(q["topic"])
        if q["level"] != state.level:
            continue
        for pid in q["passages"]:
            p = content.passages[pid]
            if not set(p["prerequisites"]) <= encountered:
                continue
            if not set(q["prerequisites"]) <= encountered | set(p["concepts"]):
                continue
            last = seen.get(q["id"])
            # Retention evidence is explicitly labeled, never passed off as unseen.
            kind = "fresh" if last is None else "reassessment" if now - last >= DAY else "review"
            review = next((r for r in due if r["concept"] == q["concept"]), None)
            priority = 0 if review and review["stage"] == 0 else 1 if review else 2
            if review_streak >= 2 and not concept and review:
                priority = 3
            if kind == "review":
                priority += 5
            used = q["id"] in [x[0] for x in state.window]
            score = (priority, q["topic"] != current, kind != "fresh", used,
                     p["concepts"][0] in encountered, passage_counts[pid], last or 0,
                     # Equally useful rounds are drawn at random, so a new game doesn't always open the same way.
                     rng.random())
            reason = "Rebuild a missed concept" if review and review["stage"] == 0 else "A retention check is due" if review else "Explore this topic"
            if kind == "review":
                reason = "Bank explored: review only; reassess after 24 hours or try another topic"
            elif kind == "reassessment":
                reason += " / delayed reassessment (seen before)"
            candidates.append((score, Recommendation(p, q, reason, kind, bool(review))))
    if not candidates:
        raise ValueError("No eligible lessons. Choose another topic.")
    return min(candidates, key=lambda x: x[0])[1]
