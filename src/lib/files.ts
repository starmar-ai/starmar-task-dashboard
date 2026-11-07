import type { Locale } from './types'

/** Hard limit per file. The Storage bucket and the task_attachments table enforce the same number. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024

/** Storage included in the Supabase Free plan. Change this if the plan changes. */
export const STORAGE_QUOTA_BYTES = 1024 * 1024 * 1024

export const FILES_BUCKET = 'task-files'

export function formatBytes(bytes: number, locale: Locale): string {
  const fmt = (n: number, digits: number) =>
    new Intl.NumberFormat(locale === 'id' ? 'id-ID' : 'en-GB', { maximumFractionDigits: digits }).format(n)
  if (bytes < 1024) return `${fmt(bytes, 0)} B`
  if (bytes < 1024 * 1024) return `${fmt(bytes / 1024, 0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${fmt(bytes / (1024 * 1024), 1)} MB`
  return `${fmt(bytes / (1024 * 1024 * 1024), 2)} GB`
}

/**
 * Storage object keys only accept a safe subset of characters, so the stored name is simplified.
 * The original name is kept in task_attachments.file_name for display.
 */
export function safeFileName(name: string): string {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot + 1) : ''
  const clean = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  const b = clean(base).slice(0, 80) || 'file'
  const e = clean(ext).slice(0, 10)
  return e ? `${b}.${e}` : b
}

export function storagePath(taskId: string, fileName: string, nonce: string): string {
  return `${taskId}/${nonce}/${safeFileName(fileName)}`
}

/** Accepts "drive.google.com/..." as well as full URLs. Returns null when it is not a web link. */
export function normalizeUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw || /\s/.test(raw)) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
  try {
    const u = new URL(withScheme)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null
    return u.toString()
  } catch {
    return null
  }
}

export function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
