"""Load and validate the offline, versioned curriculum."""
import json
from importlib.resources import files
from pathlib import Path


class ContentError(ValueError):
    pass


class Content:
    def __init__(self, path=None):
        raw = Path(path).read_text() if path else files("metabotype").joinpath("data/curriculum.json").read_text()
        self.data = json.loads(raw)
        self.validate()
        self.topics = {x["id"]: x for x in self.data["topics"]}
        self.passages = {x["id"]: x for x in self.data["passages"]}
        self.questions = {x["id"]: x for x in self.data["questions"]}

    def validate(self):
        def require(ok, message):
            if not ok:
                raise ContentError(message)
        try:
            require(self.data["version"] == 1, "Unsupported content format")
            for name in ("topics", "passages", "questions", "sources"):
                items = self.data[name]
                require(items and len({x["id"] for x in items}) == len(items), f"Duplicate or missing {name} IDs")
            topics = {x["id"] for x in self.data["topics"]}
            passages = {x["id"]: x for x in self.data["passages"]}
            concepts = {c for p in passages.values() for c in p["concepts"]}
            sources = {x["id"] for x in self.data["sources"]}
            for p in passages.values():
                require(p["topic"] in topics, f"Unknown topic in {p['id']}")
                require(p["version"] >= 1 and p["concepts"], f"Missing metadata in {p['id']}")
                require(50 <= len(p["text"].split()) <= 90, f"Passage {p['id']} must have 50-90 words")
                require(all(32 <= ord(c) <= 126 for c in p["text"]), f"Non-ASCII text: {p['id']}")
                require(p["sources"] and set(p["sources"]) <= sources, f"Invalid sources: {p['id']}")
                require(set(p["prerequisites"]) <= concepts, f"Unknown prerequisites: {p['id']}")
            reached = set()
            while True:
                old = reached.copy()
                for p in passages.values():
                    if set(p["prerequisites"]) <= reached:
                        reached.update(p["concepts"])
                if old == reached:
                    break
            require(reached == concepts, "Unreachable passage prerequisites")
            for q in self.data["questions"]:
                label = q["id"]
                opts = q["options"]
                require(q["topic"] in topics and q["level"] in range(1, 5), f"Invalid topic/level: {label}")
                require(q["concept"] in concepts and q["version"] >= 1, f"Invalid metadata: {label}")
                require(3 <= len(opts) <= 4 and len({o['id'] for o in opts}) == len(opts), f"Invalid options: {label}")
                require(q["correct"] in {o["id"] for o in opts}, f"Missing correct option: {label}")
                require(all(o["explanation"] for o in opts) and q["explanation"], f"Missing explanation: {label}")
                require(set(q["prerequisites"]) <= concepts, f"Unknown prerequisites: {label}")
                require(q["sources"] and set(q["sources"]) <= sources, f"Invalid sources: {label}")
                require(q["passages"] and set(q["passages"]) <= passages.keys(), f"Unknown passage: {label}")
                for pid in q["passages"]:
                    p = passages[pid]
                    require(p["topic"] == q["topic"] and q["concept"] in p["concepts"], f"Incompatible passage: {label}")
                    require(set(q["prerequisites"]) <= reached, f"Unreachable question: {label}")
            for topic in topics:
                require(sum(p["topic"] == topic for p in passages.values()) >= 5, f"Too few passages: {topic}")
                for level in range(1, 5):
                    qs = [q for q in self.data["questions"] if q["topic"] == topic and q["level"] == level]
                    require(len(qs) >= 10, f"Need ten questions for {topic} level {level}")
            for c in concepts:
                for level in range(1, 5):
                    require(sum(q["concept"] == c and q["level"] == level for q in self.data["questions"]) >= 2,
                            f"Need alternate question for {c} level {level}")
        except (KeyError, TypeError) as exc:
            raise ContentError(f"Malformed content: {exc}") from exc
