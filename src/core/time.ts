/** Local-calendar helpers. Timestamps are epoch seconds; days are the device's local dates. */

export interface LocalDate { y: number; m: number; d: number }

export function localDate(ts: number): LocalDate {
  const date = new Date(ts * 1000)
  return { y: date.getFullYear(), m: date.getMonth(), d: date.getDate() }
}

/** DST-safe ordinal day number for comparisons and differences. */
export function dayNumber(date: LocalDate): number {
  return Math.floor(Date.UTC(date.y, date.m, date.d) / 864e5)
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(date.y, date.m, date.d + days)
  return { y: shifted.getFullYear(), m: shifted.getMonth(), d: shifted.getDate() }
}

export function dateKey(date: LocalDate): string {
  const mm = String(date.m + 1).padStart(2, '0')
  const dd = String(date.d).padStart(2, '0')
  return `${date.y}-${mm}-${dd}`
}

export function parseDateKey(key: string): LocalDate {
  const [y, m, d] = key.split('-').map(Number)
  return { y, m: m - 1, d }
}

/** Python statistics.median: mean of the two middle values for even counts. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  if (!n) throw new Error('median of empty data')
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Sep 12" or "Sep 12 '26", matching the terminal notebook's axis labels. */
export function axisLabel(key: string, includeYear: boolean): string {
  const date = parseDateKey(key)
  const base = `${MONTHS[date.m]} ${String(date.d).padStart(2, '0')}`
  return includeYear ? `${base} '${String(date.y).slice(-2)}` : base
}

/** "MM-DD HH:MM" for the recent rounds list. */
export function stamp(ts: number): string {
  const date = new Date(ts * 1000)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}

export function msUntilLocalMidnight(now = Date.now()): number {
  const date = new Date(now)
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
  return Math.max(1000, next.getTime() - now)
}
