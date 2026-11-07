import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { errorMessage, useI18n } from '../lib/i18n'
import { useAuth } from '../auth/AuthProvider'
import { formatDateTime } from '../lib/dates'
import type { Profile, TaskComment } from '../lib/types'
import { Avatar } from './Chips'
import { ConfirmDialog } from './Modal'
import { ErrorState, LoadingState } from './States'

interface Props {
  taskId: string
  people: Profile[]
}

export function TaskComments({ taskId, people }: Props) {
  const { t, locale } = useI18n()
  const { profile } = useAuth()

  const [comments, setComments] = useState<TaskComment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<TaskComment | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    const { data, error } = await supabase.from('task_comments').select('*').eq('task_id', taskId).order('created_at')
    if (error) setLoadError(error.message)
    else setComments(data as TaskComment[])
    setLoading(false)
  }, [taskId])

  useEffect(() => {
    load()
  }, [load])

  async function send(e?: FormEvent) {
    e?.preventDefault()
    const text = body.trim()
    if (!text || busy) return
    setBusy(true)
    setError(null)
    const { data, error } = await supabase
      .from('task_comments')
      .insert({ task_id: taskId, body: text })
      .select('*')
      .single()
    setBusy(false)
    if (error) return setError(errorMessage(t, error))
    setComments((prev) => [...prev, data as TaskComment])
    setBody('')
  }

  async function remove() {
    if (!deleting) return
    const c = deleting
    setBusy(true)
    const { error } = await supabase.from('task_comments').delete().eq('id', c.id)
    setBusy(false)
    setDeleting(null)
    if (error) return setError(errorMessage(t, error))
    setComments((prev) => prev.filter((x) => x.id !== c.id))
  }

  const timezone = profile?.timezone ?? 'Asia/Jakarta'
  const isAdmin = profile?.role === 'admin'

  return (
    <section className="task-extra" aria-labelledby="comments-title">
      <header className="task-extra-head">
        <h3 id="comments-title">
          {comments.length ? t('comments.titleCount', { n: comments.length }) : t('comments.title')}
        </h3>
      </header>

      {loading ? (
        <LoadingState />
      ) : loadError ? (
        <ErrorState message={t('comments.loadError')} detail={loadError} onRetry={load} />
      ) : comments.length === 0 ? (
        <p className="task-extra-empty">{t('comments.empty')}</p>
      ) : (
        <ol className="comment-list">
          {comments.map((c) => {
            const author = people.find((p) => p.id === c.author_id)
            const name = author ? author.full_name || author.email : t('comments.unknown')
            const mine = profile != null && c.author_id === profile.id
            return (
              <li key={c.id} className="comment">
                <Avatar name={name} />
                <div className="comment-main">
                  <p className="comment-head">
                    <strong>
                      {name}
                      {mine && <span className="muted"> ({t('common.you')})</span>}
                    </strong>
                    <time className="muted small" dateTime={c.created_at}>
                      {formatDateTime(c.created_at, locale, timezone)}
                    </time>
                  </p>
                  <p className="comment-body">{c.body}</p>
                </div>
                {(mine || isAdmin) && (
                  <button
                    type="button"
                    className="icon-btn comment-delete"
                    onClick={() => setDeleting(c)}
                    aria-label={t('comments.delete')}
                    title={t('comments.delete')}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path
                        d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                )}
              </li>
            )
          })}
        </ol>
      )}

      <form className="comment-form" onSubmit={send}>
        <div className="field">
          <label htmlFor="comment-body">{t('comments.new')}</label>
          <textarea
            id="comment-body"
            rows={3}
            maxLength={2000}
            placeholder={t('comments.placeholder')}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                send()
              }
            }}
          />
        </div>
        <div className="comment-actions">
          <span className="muted small">{t('comments.hint')}</span>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !body.trim()}>
            {busy ? t('comments.sending') : t('comments.send')}
          </button>
        </div>
      </form>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {deleting && (
        <ConfirmDialog
          message={t('comments.deleteConfirm')}
          confirmLabel={t('comments.delete')}
          busy={busy}
          onConfirm={remove}
          onCancel={() => setDeleting(null)}
        />
      )}
    </section>
  )
}
