import { describe, expect, it } from 'vitest'
import { chartGeometry, compactSeries, wpmRange } from '../../src/core/charts.ts'
import { axisLabel, dateKey, dayNumber, localDate, median } from '../../src/core/time.ts'
import fixtures from '../fixtures/charts.json'

describe('compactSeries', () => {
  it('long histories keep old data and empty intervals', () => {
    const values = [10, 20, null, null, 30, 90, 0, null]
    expect(compactSeries(values, 4)).toEqual([null, 15, null, null, null, 60, 0, null])
    expect(compactSeries([1, null, 3], 10)).toEqual([1, null, 3])
  })

  it('grouping keeps sparse scores on the days they were played', () => {
    const values = [null, 20, null, null, null, null, 40, null]
    expect(compactSeries(values, 2)).toEqual(values)
  })

  it('understanding keeps brief level changes in long histories', () => {
    const levels = [1, 4, 1, 1, 1, 1]
    expect(compactSeries(levels, 2, true)).toEqual(levels)
  })

  it('rejects zero width', () => {
    expect(() => compactSeries([42], 0)).toThrow()
  })

  it('matches Python fixtures', () => {
    for (const c of fixtures) expect(compactSeries(c.values, c.columns, c.step)).toEqual(c.result)
  })
})

describe('chart geometry', () => {
  it('places single observations in the middle and clamps to the range', () => {
    expect(chartGeometry([42], 100, 50, 50)).toEqual([{ index: 0, x: 50, y: 50 - 42, value: 42 }])
    const [p] = chartGeometry([null, 200, null], 100, 50, 50, 0)
    expect([p.x, p.y]).toEqual([50, 0])
  })

  it('rounds the WPM axis outward to tens', () => {
    expect(wpmRange([])).toEqual([0, 10])
    expect(wpmRange([42])).toEqual([30, 50])
    expect(wpmRange([3, 96])).toEqual([0, 110])
  })
})

describe('time helpers', () => {
  it('median follows Python statistics.median', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(() => median([])).toThrow()
  })

  it('formats dates like the terminal notebook', () => {
    expect(axisLabel('2026-09-12', false)).toBe('Sep 12')
    expect(axisLabel('2024-09-12', true)).toBe("Sep 12 '24")
    expect(dateKey(localDate(1789257600))).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(dayNumber({ y: 2026, m: 2, d: 9 }) - dayNumber({ y: 2026, m: 2, d: 8 })).toBe(1)
  })
})
