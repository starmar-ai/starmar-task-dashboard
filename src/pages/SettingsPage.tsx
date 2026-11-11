import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { errorMessage, useI18n } from '../lib/i18n'
import { useAuth } from '../auth/AuthProvider'
import { useLookups } from '../lib/useTeam'
import { SWATCHES, TIMEZONES, type Label, type Locale, type Theme } from '../lib/types'
import { ConfirmDialog } from '../components/Modal'
import { ErrorState, LoadingState } from '../components/States'
import { LabelTag } from '../components/Chips'
import { NotificationSettingsCard } from '../components/NotificationSettings'
import { openShortcutHelp } from '../lib/shortcuts'

export function SettingsPage() {
  const { t } = useI18n()
  const { profile, updateProfile } = useAuth()
  const lookups = useLookups()
  const isAdmin = profile?.role === 'admin'

  const [name, setName] = useState(profile?.full_name ?? '')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [labelName, setLabelName] = useState('')
  const [labelColor, setLabelColor] = useState(SWATCHES[3])
  const [deleting, setDeleting] = useState<Label | null>(null)

  if (!profile) return null

  async function save(patch: Parameters<typeof updateProfile>[0]) {
    setNotice(null)
    setError(null)
    const err = await updateProfile(patch)
    if (err) setError(errorMessage(t, { message: err }))
    else setNotice(t('settings.saved'))
  }

  async function onSaveName(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError(t('taskForm.required'))
    save({ full_name: name.trim() })
  }

  async function addLabel(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!labelName.trim()) return
    const { data, error } = await supabase.from('labels').insert({ name: labelName.trim(), color: labelColor }).select('id,name,color').single()
    if (error) return setError(errorMessage(t, error))
    lookups.setLabels((prev) => [...prev, data as Label].sort((a, b) => a.name.localeCompare(b.name)))
    setLabelName('')
  }

  async function renameLabel(label: Label, newName: string) {
    if (!newName.trim() || newName.trim() === label.name) return
    setError(null)
    const { error } = await supabase.from('labels').update({ name: newName.trim() }).eq('id', label.id)
    if (error) return setError(errorMessage(t, error))
    lookups.setLabels((prev) => prev.map((l) => (l.id === label.id ? { ...l, name: newName.trim() } : l)))
  }

  async function deleteLabel() {
    if (!deleting) return
    const { error } = await supabase.from('labels').delete().eq('id', deleting.id)
    if (error) setError(errorMessage(t, error))
    else lookups.setLabels((prev) => prev.filter((l) => l.id !== deleting.id))
    setDeleting(null)
  }

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <h1>{t('settings.title')}</h1>
      </header>

      <div aria-live="polite">
        {notice && <p className="form-info">{notice}</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <section className="card" aria-labelledby="s-profile">
        <h2 id="s-profile">{t('settings.profile')}</h2>
        <form className="inline-add" onSubmit={onSaveName}>
          <div className="field grow">
            <label htmlFor="s-name">{t('settings.name')}</label>
            <input id="s-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-secondary">
            {t('common.save')}
          </button>
        </form>
        <p className="muted small">{profile.email}</p>
      </section>

      <section className="card" aria-labelledby="s-appearance">
        <h2 id="s-appearance">{t('settings.appearance')}</h2>
        <div className="settings-row">
          <fieldset className="segmented">
            <legend className="field-label">{t('settings.theme')}</legend>
            {(['light', 'dark'] as Theme[]).map((th) => (
              <label key={th} className={profile.theme === th ? 'is-on' : ''}>
                <input type="radio" name="theme" checked={profile.theme === th} onChange={() => save({ theme: th })} />
                {th === 'light' ? t('settings.themeLight') : t('settings.themeDark')}
              </label>
            ))}
          </fieldset>
          <fieldset className="segmented">
            <legend className="field-label">{t('settings.language')}</legend>
            {(['id', 'en'] as Locale[]).map((l) => (
              <label key={l} className={profile.locale === l ? 'is-on' : ''}>
                <input type="radio" name="locale" checked={profile.locale === l} onChange={() => save({ locale: l })} />
                {l === 'id' ? 'Indonesia' : 'English'}
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label htmlFor="s-tz">{t('settings.timezone')}</label>
            <select id="s-tz" value={profile.timezone} onChange={(e) => save({ timezone: e.target.value })}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz} ({tz === 'Asia/Jakarta' ? 'WIB' : tz === 'Asia/Makassar' ? 'WITA' : 'WIT'})
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <NotificationSettingsCard />

      <section className="card settings-shortcuts" aria-labelledby="s-shortcuts">
        <h2 id="s-shortcuts">{t('settings.shortcuts')}</h2>
        <p className="muted small">{t('settings.shortcutsHint')}</p>
        <button type="button" className="btn btn-secondary" onClick={openShortcutHelp}>
          {t('settings.shortcutsOpen')}
        </button>
      </section>

      <section className="card" aria-labelledby="s-labels">
        <h2 id="s-labels">{t('settings.labels')}</h2>
        <p className="muted small">{t('settings.labelsHint')}</p>
        {lookups.loading ? (
          <LoadingState />
        ) : lookups.error ? (
          <ErrorState message={t('error.generic', { message: '' })} detail={lookups.error} onRetry={lookups.reload} />
        ) : lookups.labels.length === 0 ? (
          <p className="muted">{t('settings.labelsEmpty')}</p>
        ) : (
          <ul className="label-list">
            {lookups.labels.map((l) => (
              <li key={l.id}>
                {isAdmin ? (
                  <>
                    <span className="swatch" style={{ background: l.color }} aria-hidden="true" />
                    <label htmlFor={`lbl-${l.id}`} className="sr-only">
                      {t('settings.labelName')}
                    </label>
                    <input
                      id={`lbl-${l.id}`}
                      defaultValue={l.name}
                      maxLength={40}
                      onBlur={(e) => renameLabel(l, e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                    <button type="button" className="btn btn-ghost btn-sm btn-danger-text" onClick={() => setDeleting(l)}>
                      {t('common.delete')}
                    </button>
                  </>
                ) : (
                  <LabelTag name={l.name} color={l.color} />
                )}
              </li>
            ))}
          </ul>
        )}
        <form className="inline-add" onSubmit={addLabel}>
          <div className="field grow">
            <label htmlFor="s-label">{t('taskForm.newLabel')}</label>
            <input id="s-label" maxLength={40} value={labelName} onChange={(e) => setLabelName(e.target.value)} />
          </div>
          <fieldset className="swatches swatches-sm">
            <legend className="sr-only">{t('projectForm.color')}</legend>
            {SWATCHES.map((c, i) => (
              <label key={c} className="swatch-option">
                <input type="radio" name="label-color" checked={labelColor === c} onChange={() => setLabelColor(c)} />
                <span className="swatch-big" style={{ background: c }} />
                <span className="sr-only">{t('projectForm.colorOption', { n: i + 1 })}</span>
              </label>
            ))}
          </fieldset>
          <button type="submit" className="btn btn-secondary">
            {t('taskForm.addLabel')}
          </button>
        </form>
      </section>

      {deleting && (
        <ConfirmDialog
          message={t('settings.labelDeleteConfirm', { name: deleting.name })}
          confirmLabel={t('common.delete')}
          onConfirm={deleteLabel}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
