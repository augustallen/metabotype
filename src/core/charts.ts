/** Chart series helpers with calendar spacing. Port of compact_series from cli/src/metabotype/ui/charts.py. */
import { median } from './time.ts'

/**
 * Aggregate WPM into calendar intervals without shifting observation dates.
 * Each interval's median lands on its last observed day, keeping the timeline
 * length intact. Levels (step) keep every change, including brief reversals.
 */
export function compactSeries(values: (number | null)[], columns: number, step = false): (number | null)[] {
  if (columns < 1) throw new Error('Chart width must be positive')
  if (step || values.length <= columns) return [...values]
  const result: (number | null)[] = values.map(() => null)
  for (let column = 0; column < columns; column++) {
    const start = Math.floor((column * values.length) / columns)
    const end = Math.floor(((column + 1) * values.length) / columns)
    const observed: [number, number][] = []
    for (let i = start; i < end; i++) {
      const v = values[i]
      if (v !== null) observed.push([i, v])
    }
    if (observed.length) result[observed[observed.length - 1][0]] = median(observed.map((x) => x[1]))
  }
  return result
}

export interface ChartPoint { index: number; x: number; y: number; value: number }

/** Map observations to plot coordinates (0..width, 0..height, y grows downward). */
export function chartGeometry(values: (number | null)[], width: number, height: number, maximum: number,
  minimum = 0): ChartPoint[] {
  const span = maximum - minimum || 1
  const points: ChartPoint[] = []
  values.forEach((value, index) => {
    if (value === null) return
    const x = values.length > 1 ? (index / (values.length - 1)) * width : width / 2
    const clamped = Math.min(maximum, Math.max(minimum, value))
    const y = height - ((clamped - minimum) / span) * height
    points.push({ index, x, y, value })
  })
  return points
}

/** Axis range for WPM: round outward to tens with a five-point margin. */
export function wpmRange(values: (number | null)[]): [number, number] {
  const observed = values.filter((v): v is number => v !== null)
  const low = observed.length ? Math.min(...observed) : 0
  const high = observed.length ? Math.max(...observed) : 0
  const minimum = Math.max(0, Math.floor((low - 5) / 10) * 10)
  const maximum = Math.max(minimum + 10, Math.ceil((high + 5) / 10) * 10)
  return [minimum, maximum]
}
