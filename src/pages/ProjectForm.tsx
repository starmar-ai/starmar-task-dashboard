import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { removeFilesOfTasks } from '../lib/taskFiles'
import { errorMessage, useI18n } from '../lib/i18n'
import { useAuth } from '../auth/AuthProvider'
import { PROJECT_STATUSES, SWATCHES, type Profile, type ProjectOverview, type ProjectStatus } from '../lib/types'
import { ConfirmDialog, Modal } from '../components/Modal'

interface Props {
  project: ProjectOverview | null
  people: Profile[]
  onClose: () => void
  onSaved: () => void
}

export function ProjectForm({ project, people, onClose, onSaved }: Props) {
  const { t } = useI18n()
  const { profile } = useAuth()
  const [name, setName] = useState(project?.name ?? '')
  const [color, setColor] = useState(project?.color ?? SWATCHES[0])
  const [pmId, setPmId] = useState(project?.pm_id ?? profile?.id ?? '')
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? 'aktif')
  const [client, setClient] = useState(project?.client_label ?? '')
  const [archived, setArchived] = useState(project?.archived ?? false)
  const [members, setMembers] = useState<string[]>([])
  const [initialMembers, setInitialMembers] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!project) return
    supabase
      .from('project_members')
      .select('user_id')
      .eq('project_id', project.id)
      .then(({ data, error }) => {
        if (error) return setError(errorMessage(t, error))
        const ids = (data ?? []).map((r) => r.user_id as string)
        setMembers(ids)
        setInitialMembers(ids)
      })
  }, [project, t])

  const activePeople = people.filter((p) => p.active !== false || p.id === pmId)
  const memberChoices = people.filter((p) => (p.active !== false && p.role !== 'admin') || initialMembers.includes(p.id))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) return setError(t('taskForm.required'))
    setBusy(true)
    const values = {
      name: name.trim(),
      color,
      pm_id: pmId || null,
      status,
      client_label: client.trim() || null,
      archived,
    }
    const res = project
      ? await supabase.from('projects').update(values).eq('id', project.id).select('id').single()
      : await supabase.from('projects').insert(values).select('id').single()
    if (res.error) {
      setBusy(false)
      return setError(errorMessage(t, res.error))
    }
    const projectId = res.data.id as string
    const toAdd = members.filter((m) => !initialMembers.includes(m))
    const toRemove = initialMembers.filter((m) => !members.includes(m))
    if (toAdd.length) {
      const { error } = await supabase.from('project_members').insert(toAdd.map((user_id) => ({ project_id: projectId, user_id })))
      if (error) {
        setBusy(false)
        return setError(errorMessage(t, error))
      }
    }
    if (toRemove.length) {
      const { error } = await supabase.from('project_members').delete().eq('project_id', projectId).in('user_id', toRemove)
      if (error) {
        setBusy(false)
        return setError(errorMessage(t, error))
      }
    }
    setBusy(false)
    onSaved()
  }

  async function onDelete() {
    if (!project) return
    setBusy(true)
    // Best effort: a failed file cleanup must not block deleting the project.
    await removeFilesOfTasks({ projectId: project.id })
    const { error } = await supabase.from('projects').delete().eq('id', project.id)
    setBusy(false)
    setConfirmDelete(false)
    if (error) return setError(errorMessage(t, error))
    onSaved()
  }

  return (
    <>
      <Modal
        title={project ? t('projectForm.editTitle') : t('projectForm.newTitle')}
        onClose={onClose}
        footer={
          <>
            {project && (
              <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => setConfirmDelete(true)}>
                {t('common.delete')}
              </button>
            )}
            <span className="spacer" />
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" form="project-form" className="btn btn-primary" disabled={busy}>
              {busy ? t('common.saving') : t('common.save')}
            </button>
          </>
        }
      >
        <form id="project-form" onSubmit={onSubmit} className="form-grid">
          <div className="field span-2">
            <label htmlFor="pf-name">
              {t('projectForm.name')} <span className="req" aria-hidden="true">*</span>
            </label>
            <input id="pf-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <fieldset className="field span-2 swatch-field">
            <legend className="field-label">{t('projectForm.color')}</legend>
            <div className="swatches">
              {SWATCHES.map((c, i) => (
                <label key={c} className="swatch-option">
                  <input type="radio" name="pf-color" value={c} checked={color === c} onChange={() => setColor(c)} />
                  <span className="swatch-big" style={{ background: c }} />
                  <span className="sr-only">{t('projectForm.colorOption', { n: i + 1 })}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="field">
            <label htmlFor="pf-pm">{t('projectForm.pm')}</label>
            <select id="pf-pm" value={pmId} onChange={(e) => setPmId(e.target.value)}>
              <option value="">{t('common.none')}</option>
              {activePeople.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || p.email}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pf-status">{t('projectForm.status')}</label>
            <select id="pf-status" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`pstatus.${s}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field span-2">
            <label htmlFor="pf-client">
              {t('projectForm.client')} <span className="muted">({t('common.optional')})</span>
            </label>
            <input id="pf-client" maxLength={60} value={client} onChange={(e) => setClient(e.target.value)} />
          </div>
          <fieldset className="field span-2">
            <legend className="field-label">{t('projectForm.members')}</legend>
            <p className="muted small">{t('projectForm.membersHint')}</p>
            {memberChoices.length === 0 && <p className="muted small">{t('projectForm.membersEmpty')}</p>}
            <div className="label-picker">
              {memberChoices.map((p) => {
                const on = members.includes(p.id)
                return (
                  <label key={p.id} className={`label-option ${on ? 'is-on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => setMembers((m) => (e.target.checked ? [...m, p.id] : m.filter((x) => x !== p.id)))}
                    />
                    {p.full_name || p.email}
                  </label>
                )
              })}
            </div>
          </fieldset>
          {project && (
            <label className="check span-2">
              <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
              {t('projectForm.archived')}
            </label>
          )}
          <p className="muted small span-2">{t('projectForm.datesNote')}</p>
        </form>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </Modal>
      {confirmDelete && project && (
        <ConfirmDialog
          message={t('projectForm.deleteConfirm', { name: project.name, n: project.task_total })}
          confirmLabel={t('common.delete')}
          busy={busy}
          onConfirm={onDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  )
}
