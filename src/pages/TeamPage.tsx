import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { errorMessage, useI18n, type TFn } from '../lib/i18n'
import { useAuth } from '../auth/AuthProvider'
import { useLookups } from '../lib/useTeam'
import { inviteState, type InviteState, type TeamStatusRow } from '../lib/team'
import type { Profile, Project, Role } from '../lib/types'
import { Avatar, ProjectName } from '../components/Chips'
import { ConfirmDialog, Modal } from '../components/Modal'
import { EmptyState, ErrorState, LoadingState } from '../components/States'

type ApiResult = { ok: true; link: string | null } | { ok: false; message: string }

async function callTeamApi(t: TFn, body: Record<string, unknown>): Promise<ApiResult> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return { ok: false, message: t('error.permission') }
  let res: Response
  try {
    res = await fetch('/api/team', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, message: t('team.err.network') }
  }
  const json = (await res.json().catch(() => null)) as { error?: string; detail?: string; link?: string | null } | null
  if (res.ok && json) return { ok: true, link: json.link ?? null }
  switch (json?.error) {
    case 'admin_only':
      return { ok: false, message: t('error.permission') }
    case 'invalid_email':
      return { ok: false, message: t('team.err.email') }
    case 'already_joined':
      return { ok: false, message: t('team.err.joined') }
    case 'email_rate_limit':
      return { ok: false, message: t('team.err.rateLimit') }
    case 'cannot_revoke_self':
      return { ok: false, message: t('team.err.self') }
    case 'cannot_revoke_admin':
      return { ok: false, message: t('team.err.admin') }
    case 'failed':
      return { ok: false, message: t('error.generic', { message: json.detail ?? '' }) }
    default:
      // No JSON at all means the function is not deployed (local dev) or the key is missing.
      return { ok: false, message: t('team.err.server') }
  }
}

function InviteChip({ state }: { state: InviteState }) {
  const { t } = useI18n()
  const glyph = state === 'active' ? '✓' : state === 'pending' ? '◎' : '–'
  return (
    <span className={`chip chip-invite-${state}`}>
      <span aria-hidden="true" className="chip-glyph">
        {glyph}
      </span>
      {t(`team.state.${state}`)}
    </span>
  )
}

export function TeamPage() {
  const { t } = useI18n()
  const { profile } = useAuth()
  const lookups = useLookups()
  const isAdmin = profile?.role === 'admin'

  const [status, setStatus] = useState<Map<string, TeamStatusRow>>(new Map())
  const [statusError, setStatusError] = useState<string | null>(null)

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [inviteProjects, setInviteProjects] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [result, setResult] = useState<{ email: string; link: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const [editing, setEditing] = useState<Profile | null>(null)
  const [revoking, setRevoking] = useState<Profile | null>(null)

  const loadStatus = useCallback(async () => {
    const { data, error } = await supabase.rpc('team_status')
    if (error) return setStatusError(error.message)
    setStatusError(null)
    setStatus(new Map((data as TeamStatusRow[]).map((r) => [r.user_id, r])))
  }, [])

  useEffect(() => {
    if (isAdmin) loadStatus()
  }, [isAdmin, loadStatus])

  const openProjects = useMemo(() => lookups.projects.filter((p) => !p.archived), [lookups.projects])

  if (!profile) return null
  if (!isAdmin) {
    return (
      <div className="page page-narrow">
        <h1>{t('team.title')}</h1>
        <p>{t('team.adminOnly')}</p>
        <Link to="/dashboard" className="btn btn-secondary">
          {t('notFound.back')}
        </Link>
      </div>
    )
  }

  async function reloadAll() {
    await Promise.all([lookups.reload(), loadStatus()])
  }

  async function invite(target: { email: string; full_name?: string; project_ids?: string[] }, sendEmail: boolean, key: string) {
    setError(null)
    setNotice(null)
    setResult(null)
    setCopied(false)
    setBusy(key)
    const res = await callTeamApi(t, { action: 'invite', ...target, send_email: sendEmail })
    setBusy(null)
    if (!res.ok) return setError(res.message)
    if (res.link) setResult({ email: target.email, link: res.link })
    else setNotice(t('team.emailSent', { email: target.email }))
    await reloadAll()
    return true
  }

  async function onInvite(e: { preventDefault(): void }, sendEmail: boolean) {
    e.preventDefault()
    if (!email.trim()) return setError(t('team.err.email'))
    const ok = await invite({ email: email.trim(), full_name: name.trim(), project_ids: inviteProjects }, sendEmail, sendEmail ? 'form-email' : 'form-link')
    if (ok) {
      setEmail('')
      setName('')
      setInviteProjects([])
    }
  }

  async function setActive(person: Profile, active: boolean) {
    setError(null)
    setNotice(null)
    setBusy(`active-${person.id}`)
    const res = await callTeamApi(t, { action: 'set_active', user_id: person.id, active })
    setBusy(null)
    setRevoking(null)
    if (!res.ok) return setError(res.message)
    setNotice(active ? t('team.restored', { name: person.full_name || person.email }) : t('team.revoked', { name: person.full_name || person.email }))
    await reloadAll()
  }

  async function changeRole(person: Profile, role: Role) {
    setError(null)
    setNotice(null)
    const { error } = await supabase.from('profiles').update({ role }).eq('id', person.id)
    if (error) setError(errorMessage(t, error))
    else setNotice(t('settings.saved'))
    lookups.reload()
  }

  async function copyLink() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.link)
      setCopied(true)
    } catch {
      setError(t('team.copyFailed'))
    }
  }

  const projectById = new Map(lookups.projects.map((p) => [p.id, p]))
  const accessOf = (person: Profile): Project[] => {
    const ids = new Set(lookups.members.filter((m) => m.user_id === person.id).map((m) => m.project_id))
    return lookups.projects.filter((p) => ids.has(p.id) || p.pm_id === person.id)
  }
  const others = lookups.people.filter((p) => p.id !== profile.id)
  const whatsapp = result ? `https://wa.me/?text=${encodeURIComponent(t('team.waText', { link: result.link }))}` : ''

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <h1>{t('team.title')}</h1>
      </header>

      <div aria-live="polite">
        {notice && <p className="form-info">{notice}</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <section className="card" aria-labelledby="team-invite">
        <h2 id="team-invite">{t('team.inviteTitle')}</h2>
        <p className="muted small">{t('team.inviteHint')}</p>
        <form className="form-grid" onSubmit={(e) => onInvite(e, false)}>
          <div className="field">
            <label htmlFor="inv-email">
              {t('login.email')} <span className="req" aria-hidden="true">*</span>
            </label>
            <input id="inv-email" type="email" required autoComplete="off" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="inv-name">
              {t('settings.name')} <span className="muted">({t('common.optional')})</span>
            </label>
            <input id="inv-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <fieldset className="field span-2">
            <legend className="field-label">{t('team.inviteProjects')}</legend>
            {openProjects.length === 0 ? (
              <p className="muted small">{t('team.noProjectsYet')}</p>
            ) : (
              <div className="label-picker">
                {openProjects.map((p) => {
                  const on = inviteProjects.includes(p.id)
                  return (
                    <label key={p.id} className={`label-option ${on ? 'is-on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => setInviteProjects((ids) => (e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id)))}
                      />
                      {p.name}
                    </label>
                  )
                })}
              </div>
            )}
          </fieldset>
          <div className="span-2 team-invite-actions">
            <button type="submit" className="btn btn-primary" disabled={busy !== null}>
              {busy === 'form-link' ? t('common.saving') : t('team.makeLink')}
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={(e) => onInvite(e, true)}>
              {busy === 'form-email' ? t('common.saving') : t('team.sendEmail')}
            </button>
          </div>
        </form>

        {result && (
          <div className="invite-result" role="status">
            <p>
              <strong>{t('team.linkFor', { email: result.email })}</strong>
            </p>
            <label htmlFor="inv-link" className="sr-only">
              {t('team.linkLabel')}
            </label>
            <input id="inv-link" readOnly value={result.link} onFocus={(e) => e.target.select()} />
            <div className="team-invite-actions">
              <button type="button" className="btn btn-secondary" onClick={copyLink}>
                {copied ? t('team.copied') : t('team.copy')}
              </button>
              <a className="btn btn-secondary" href={whatsapp} target="_blank" rel="noreferrer">
                {t('team.whatsapp')}
              </a>
            </div>
            <p className="muted small">{t('team.linkNote')}</p>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="team-list">
        <h2 id="team-list">{t('team.listTitle')}</h2>
        {lookups.loading ? (
          <LoadingState />
        ) : lookups.error ? (
          <ErrorState message={t('error.generic', { message: '' })} detail={lookups.error} onRetry={lookups.reload} />
        ) : (
          <>
            {statusError && <ErrorState message={t('team.statusError')} detail={statusError} onRetry={loadStatus} />}
            {others.length === 0 && <EmptyState>{t('team.empty')}</EmptyState>}
            <ul className="team-list">
              {lookups.people.map((p) => {
                const state = inviteState(p, status.get(p.id))
                const me = p.id === profile.id
                const access = accessOf(p)
                return (
                  <li key={p.id} className="team-row">
                    <div className="team-who">
                      <Avatar name={p.full_name || p.email} />
                      <span className="user-text">
                        <span>
                          {p.full_name || p.email}
                          {me && <span className="muted"> ({t('team.you')})</span>}
                        </span>
                        <span className="muted small">{p.email}</span>
                      </span>
                      <InviteChip state={state} />
                    </div>

                    <div className="team-access">
                      {p.role === 'admin' ? (
                        <span className="muted small">{t('team.allProjects')}</span>
                      ) : access.length === 0 ? (
                        <span className="muted small">{t('team.noAccess')}</span>
                      ) : (
                        <ul className="team-projects">
                          {access.map((pr) => (
                            <li key={pr.id}>
                              <ProjectName name={pr.name} color={pr.color} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="team-actions">
                      <label htmlFor={`role-${p.id}`} className="sr-only">
                        {t('settings.role')}
                      </label>
                      <select id={`role-${p.id}`} value={p.role} disabled={state === 'revoked'} onChange={(e) => changeRole(p, e.target.value as Role)}>
                        <option value="admin">{t('role.admin')}</option>
                        <option value="member">{t('role.member')}</option>
                      </select>
                      {p.role !== 'admin' && state !== 'revoked' && (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(p)}>
                          {t('team.editAccess')}
                        </button>
                      )}
                      {state === 'pending' && (
                        <>
                          <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => invite({ email: p.email }, false, `link-${p.id}`)}>
                            {busy === `link-${p.id}` ? t('common.saving') : t('team.newLink')}
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => invite({ email: p.email }, true, `mail-${p.id}`)}>
                            {busy === `mail-${p.id}` ? t('common.saving') : t('team.resendEmail')}
                          </button>
                        </>
                      )}
                      {!me && p.role !== 'admin' && state !== 'revoked' && (
                        <button type="button" className="btn btn-ghost btn-sm btn-danger-text" disabled={busy !== null} onClick={() => setRevoking(p)}>
                          {t('team.revoke')}
                        </button>
                      )}
                      {state === 'revoked' && (
                        <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => setActive(p, true)}>
                          {busy === `active-${p.id}` ? t('common.saving') : t('team.restore')}
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </section>

      {editing && (
        <AccessDialog
          person={editing}
          projects={lookups.projects.filter((p) => !p.archived || lookups.members.some((m) => m.project_id === p.id && m.user_id === editing.id))}
          memberOf={lookups.members.filter((m) => m.user_id === editing.id).map((m) => m.project_id)}
          projectById={projectById}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            setNotice(t('settings.saved'))
            lookups.reload()
          }}
        />
      )}
      {revoking && (
        <ConfirmDialog
          message={t('team.revokeConfirm', { name: revoking.full_name || revoking.email })}
          confirmLabel={t('team.revoke')}
          busy={busy !== null}
          onConfirm={() => setActive(revoking, false)}
          onCancel={() => setRevoking(null)}
        />
      )}
    </div>
  )
}

function AccessDialog({
  person,
  projects,
  memberOf,
  projectById,
  onClose,
  onSaved,
}: {
  person: Profile
  projects: Project[]
  memberOf: string[]
  projectById: Map<string, Project>
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [selected, setSelected] = useState<string[]>(memberOf)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    const toAdd = selected.filter((id) => !memberOf.includes(id))
    const toRemove = memberOf.filter((id) => !selected.includes(id))
    if (toAdd.length) {
      const { error } = await supabase.from('project_members').insert(toAdd.map((project_id) => ({ project_id, user_id: person.id })))
      if (error) {
        setBusy(false)
        return setError(errorMessage(t, error))
      }
    }
    if (toRemove.length) {
      const { error } = await supabase.from('project_members').delete().eq('user_id', person.id).in('project_id', toRemove)
      if (error) {
        setBusy(false)
        return setError(errorMessage(t, error))
      }
    }
    setBusy(false)
    onSaved()
  }

  return (
    <Modal
      title={t('team.accessTitle', { name: person.full_name || person.email })}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
            {busy ? t('common.saving') : t('common.save')}
          </button>
        </>
      }
    >
      <p className="muted small">{t('team.accessHint')}</p>
      {projects.length === 0 ? (
        <p className="muted">{t('team.noProjectsYet')}</p>
      ) : (
        <fieldset className="access-list">
          <legend className="sr-only">{t('team.accessTitle', { name: person.full_name || person.email })}</legend>
          {projects.map((p) => {
            const isPm = projectById.get(p.id)?.pm_id === person.id
            return (
              <label key={p.id} className="check">
                <input
                  type="checkbox"
                  checked={isPm || selected.includes(p.id)}
                  disabled={isPm}
                  onChange={(e) => setSelected((ids) => (e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id)))}
                />
                <ProjectName name={p.name} color={p.color} />
                {isPm && <span className="muted small">({t('team.isPm')})</span>}
              </label>
            )
          })}
        </fieldset>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}
