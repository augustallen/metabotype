/** CSV export matching the terminal command's column order and Python csv formatting. */
import { QUESTION_COLUMNS, ROUND_COLUMNS, type Model } from './model.ts'

function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  // Lists are written the way Python's json.dumps did in the SQLite export.
  const text = Array.isArray(value) ? '[' + value.map((x) => JSON.stringify(x)).join(', ') + ']'
    : typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
}

function csv(fields: string[], rows: Record<string, unknown>[]): string {
  const lines = [fields.map(cell).join(',')]
  for (const row of rows) lines.push(fields.map((f) => cell(row[f])).join(','))
  return lines.join('\r\n') + '\r\n'
}

export function roundsCsv(model: Model): string {
  const metricFields = [...new Set(model.rounds.flatMap((r) => Object.keys(r.metrics ?? {})))].sort()
  const fields = [...ROUND_COLUMNS.filter((f) => f !== 'metrics'), ...metricFields]
  const rows = model.rounds.map((r) => {
    const { metrics, ...rest } = r
    return { ...rest, ...(metrics ?? {}) } as Record<string, unknown>
  })
  return csv(fields, rows)
}

export function questionAttemptsCsv(model: Model): string {
  return csv([...QUESTION_COLUMNS], model.questions as unknown as Record<string, unknown>[])
}

export function exportStamp(now = new Date()): string {
  const two = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
}
