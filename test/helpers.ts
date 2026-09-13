import curriculum from '../content/curriculum.json'
import { Content } from '../src/core/content.ts'

export class Clock {
  now: number
  constructor(now = 0) {
    this.now = now
  }
  tick = (): number => this.now
  advance(seconds: number): void {
    this.now += seconds
  }
}

export function loadContent(): Content {
  return new Content(structuredClone(curriculum))
}
