import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { errorMessage, useI18n } from '../lib/i18n'
import { useAuth } from '../auth/AuthProvider'
import { formatDate } from '../lib/dates'
import {
  FILES_BUCKET,
  MAX_FILE_BYTES,
  STORAGE_QUOTA_BYTES,
  formatBytes,
  linkHost,
  normalizeUrl,
  storagePath,
} from '../lib/files'
import type { Profile, TaskAttachment, TaskLink } from '../lib/types'
import { ConfirmDialog } from './Modal'
import { ErrorState, LoadingState } from './States'

interface Props {
  taskId: string
  /** The current user is the task's assignee, creator, or an admin. */
  canManage: boolean
  people: Profile[]
}

type Row = { kind: 'link'; item: TaskLink } | { kind: 'file'; item: TaskAttachment; href: string | null }

export function TaskFiles({ taskId, canManage, people }: Props) {
  const { t, locale } = useI18n()
  const { profile } = useAuth()

  const [links, setLinks] = useState<TaskLink[]>([])
  const [files, setFiles] = useState<TaskAttachment[]>([])
  const [hrefs, setHrefs] = useState<Record<string, string>>({})
  const [usage, setUsage] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [uploading, setUploading] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removingFile, setRemovingFile] = useState<TaskAttachment | null>(null)

  const nameOf = (id: string | null) => {
    const p = people.find((x) => x.id === id)
    return p ? p.full_name || p.email : t('comments.unknown')
  }

  const loadUsage = useCallback(async () => {
    const { data, error } = await supabase.rpc('task_files_usage')
    if (!error) setUsage(Number(data ?? 0))
  }, [])

  const load = useCallback(async () => {
    setLoadError(null)
    const [l, f] = await Promise.all([
      supabase.from('task_links').select('*').eq('task_id', taskId).order('created_at'),
      supabase.from('task_attachments').select('*').eq('task_id', taskId).order('created_at'),
    ])
    const err = l.error || f.error
    if (err) {
      setLoadError(err.message)
      setLoading(false)
      return
    }
    const fileRows = f.data as TaskAttachment[]
    setLinks(l.data as TaskLink[])
    setFiles(fileRows)
    if (fileRows.length) {
      const { data } = await supabase.storage.from(FILES_BUCKET).createSignedUrls(
        fileRows.map((x) => x.storage_path),
        60 * 60,
        { download: true },
      )
      const map: Record<string, string> = {}
      for (const s of data ?? []) if (s.path && s.signedUrl) map[s.path] = s.signedUrl
      setHrefs(map)
    }
    setLoading(false)
  }, [taskId])

  useEffect(() => {
    load()
    loadUsage()
  }, [load, loadUsage])

  async function addLink(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const clean = normalizeUrl(url)
    if (!clean) return setError(t('files.badUrl'))
    setBusy(true)
    const { data, error } = await supabase
      .from('task_links')
      .insert({ task_id: taskId, url: clean, label: label.trim() || null })
      .select('*')
      .single()
    setBusy(false)
    if (error) return setError(errorMessage(t, error))
    setLinks((prev) => [...prev, data as TaskLink])
    setUrl('')
    setLabel('')
  }

  async function removeLink(link: TaskLink) {
    setError(null)
    const { error } = await supabase.from('task_links').delete().eq('id', link.id)
    if (error) return setError(errorMessage(t, error))
    setLinks((prev) => prev.filter((x) => x.id !== link.id))
  }

  async function onPickFiles(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!picked.length) return
    setError(null)
    const tooBig = picked.find((f) => f.size > MAX_FILE_BYTES)
    if (tooBig) return setError(t('files.tooBig', { name: tooBig.name, size: formatBytes(tooBig.size, locale) }))

    for (const file of picked) {
      setUploading(file.name)
      const path = storagePath(taskId, file.name, crypto.randomUUID())
      const up = await supabase.storage.from(FILES_BUCKET).upload(path, file, {
        contentType: file.type || undefined,
        upsert: false,
      })
      if (up.error) {
        setUploading(null)
        const tooLarge = /exceeded the maximum|too large|payload/i.test(up.error.message)
        return setError(
          tooLarge ? t('files.tooBig', { name: file.name, size: formatBytes(file.size, locale) }) : errorMessage(t, up.error),
        )
      }
      const { data, error } = await supabase
        .from('task_attachments')
        .insert({
          task_id: taskId,
          storage_path: path,
          file_name: file.name.slice(0, 200),
          size_bytes: file.size,
          mime_type: file.type || null,
        })
        .select('*')
        .single()
      if (error) {
        // Keep Storage and the table in step: drop the object if its row could not be saved.
        await supabase.storage.from(FILES_BUCKET).remove([path])
        setUploading(null)
        return setError(errorMessage(t, error))
      }
      const row = data as TaskAttachment
      const signed = await supabase.storage.from(FILES_BUCKET).createSignedUrl(path, 60 * 60, { download: true })
      setFiles((prev) => [...prev, row])
      if (signed.data) setHrefs((prev) => ({ ...prev, [path]: signed.data.signedUrl }))
    }
    setUploading(null)
    loadUsage()
  }

  async function removeFile() {
    if (!removingFile) return
    const file = removingFile
    setBusy(true)
    setError(null)
    const { error: storageErr } = await supabase.storage.from(FILES_BUCKET).remove([file.storage_path])
    const { error } = storageErr ? { error: storageErr } : await supabase.from('task_attachments').delete().eq('id', file.id)
    setBusy(false)
    setRemovingFile(null)
    if (error) return setError(errorMessage(t, error))
    setFiles((prev) => prev.filter((x) => x.id !== file.id))
    loadUsage()
  }

  const rows: Row[] = [
    ...links.map((item) => ({ kind: 'link' as const, item })),
    ...files.map((item) => ({ kind: 'file' as const, item, href: hrefs[item.storage_path] ?? null })),
  ].sort((a, b) => a.item.created_at.localeCompare(b.item.created_at))

  const mayRemove = (ownerId: string | null) => canManage || (profile != null && ownerId === profile.id)
  const usedPct = usage == null ? 0 : Math.min(100, (usage / STORAGE_QUOTA_BYTES) * 100)

  return (
    <section className="task-extra" aria-labelledby="files-title">
      <header className="task-extra-head">
        <h3 id="files-title">{t('files.title')}</h3>
        <p className="muted small">{t('extras.savedNow')}</p>
      </header>

      {loading ? (
        <LoadingState />
      ) : loadError ? (
        <ErrorState message={t('files.loadError')} detail={loadError} onRetry={load} />
      ) : rows.length === 0 ? (
        <p className="task-extra-empty">{t('files.empty')}</p>
      ) : (
        <ul className="resource-list">
          {rows.map((r) =>
            r.kind === 'link' ? (
              <li key={r.item.id} className="resource">
                <span className="resource-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18">
                    <path
                      d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <div className="resource-body">
                  <a className="resource-name" href={r.item.url} target="_blank" rel="noopener noreferrer">
                    {r.item.label || linkHost(r.item.url)}
                    <span className="sr-only"> {t('files.openNew')}</span>
                  </a>
                  <span className="muted small">
                    {t('files.linkMeta', { host: linkHost(r.item.url), name: nameOf(r.item.created_by) })}
                  </span>
                </div>
                {mayRemove(r.item.created_by) && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => removeLink(r.item)}
                    aria-label={t('files.removeLink', { name: r.item.label || linkHost(r.item.url) })}
                  >
                    {t('files.remove')}
                  </button>
                )}
              </li>
            ) : (
              <li key={r.item.id} className="resource">
                <span className="resource-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18">
                    <path
                      d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <div className="resource-body">
                  {r.href ? (
                    <a className="resource-name" href={r.href} download={r.item.file_name}>
                      {r.item.file_name}
                    </a>
                  ) : (
                    <span className="resource-name">{r.item.file_name}</span>
                  )}
                  <span className="muted small">
                    {t('files.meta', {
                      size: formatBytes(r.item.size_bytes, locale),
                      name: nameOf(r.item.uploaded_by),
                      date: formatDate(r.item.created_at.slice(0, 10), locale),
                    })}
                  </span>
                </div>
                {mayRemove(r.item.uploaded_by) && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setRemovingFile(r.item)}
                    aria-label={t('files.removeFile', { name: r.item.file_name })}
                  >
                    {t('files.remove')}
                  </button>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      <form className="link-add" onSubmit={addLink}>
        <div className="field link-add-url">
          <label htmlFor="link-url">{t('files.url')}</label>
          <input
            id="link-url"
            inputMode="url"
            autoComplete="off"
            placeholder={t('files.urlPlaceholder')}
            maxLength={2000}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <div className="field link-add-label">
          <label htmlFor="link-label">
            {t('files.linkLabel')} <span className="muted">({t('common.optional')})</span>
          </label>
          <input
            id="link-label"
            placeholder={t('files.linkLabelPlaceholder')}
            maxLength={80}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !url.trim()}>
          {t('files.addLink')}
        </button>
      </form>

      <div className="file-add">
        <label className={`btn btn-secondary btn-sm file-pick ${uploading ? 'is-busy' : ''}`}>
          <input type="file" multiple className="sr-only" onChange={onPickFiles} disabled={uploading != null} />
          {uploading ? t('files.uploading', { name: uploading }) : t('files.upload')}
        </label>
        <p className="muted small">{t('files.limitHint')}</p>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {usage != null && (
        <div className="storage-usage">
          <p className="small">
            {t('files.usage', { used: formatBytes(usage, locale), quota: formatBytes(STORAGE_QUOTA_BYTES, locale) })}
          </p>
          <div
            className={`progress-bar ${usedPct >= 80 ? 'is-high' : ''}`}
            role="progressbar"
            aria-label={t('files.usageLabel')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(usedPct)}
          >
            <span style={{ width: `${usage > 0 ? Math.max(usedPct, 1) : 0}%` }} />
          </div>
          <p className="muted small">{t('files.usageNote')}</p>
        </div>
      )}

      {removingFile && (
        <ConfirmDialog
          message={t('files.removeConfirm', { name: removingFile.file_name })}
          confirmLabel={t('files.remove')}
          busy={busy}
          onConfirm={removeFile}
          onCancel={() => setRemovingFile(null)}
        />
      )}
    </section>
  )
}
