/** Whole-history JSON backups. Import replaces everything, never merges. */
import { APP_VERSION } from '../version.ts'
import { validateModel, type Model } from './model.ts'

export const BACKUP_FORMAT = 'metabotype-backup'

export interface Backup {
  format: typeof BACKUP_FORMAT
  format_version: 1
  app_version: string
  exported_at: number
  model: Model
}

export function makeBackup(model: Model, now = Date.now() / 1000): Backup {
  return { format: BACKUP_FORMAT, format_version: 1, app_version: APP_VERSION, exported_at: now, model: structuredClone(model) }
}

export function parseBackup(text: string): Model {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Not a JSON file')
  }
  const b = parsed as Partial<Backup>
  if (!b || b.format !== BACKUP_FORMAT) throw new Error('Not a Metabotype backup')
  if (b.format_version !== 1) throw new Error(`Unsupported backup version ${String(b.format_version)}`)
  return validateModel(b.model)
}
