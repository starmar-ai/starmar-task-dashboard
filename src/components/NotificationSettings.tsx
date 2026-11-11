import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { errorMessage, useI18n } from '../lib/i18n'
import { useAuth } from '../auth/AuthProvider'
import { DEFAULT_SETTINGS, NOTIFICATION_KINDS, emitNotificationsChanged, type NotificationKind, type NotificationSettings } from '../lib/notifications'
import { ErrorState, LoadingState } from './States'

/** What reaches the bell and the inbox. Every change is saved at once. */
export function NotificationSettingsCard() {
  const { t } = useI18n()
  const { profile } = useAuth()
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const isAdmin = profile?.role === 'admin'

  async function load() {
    const { data, error } = await supabase.from('notification_settings').select('muted_kinds, email_daily, email_urgent').maybeSingle()
    if (error) setLoadError(error.message)
    else {
      setLoadError(null)
      if (data) setSettings(data as NotificationSettings)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function save(next: NotificationSettings) {
    const before = settings
    setSettings(next)
    setError(null)
    setNotice(null)
    const { error } = await supabase.rpc('save_notification_settings', {
      p_muted: next.muted_kinds,
      p_daily: next.email_daily,
      p_urgent: next.email_urgent,
    })
    if (error) {
      setSettings(before)
      return setError(errorMessage(t, error))
    }
    setNotice(t('settings.saved'))
    emitNotificationsChanged()
  }

  function toggleKind(kind: NotificationKind, on: boolean) {
    const rest = settings.muted_kinds.filter((k) => k !== kind)
    save({ ...settings, muted_kinds: on ? rest : [...rest, kind] })
  }

  const kinds = NOTIFICATION_KINDS.filter((k) => k !== 'team_overdue' || isAdmin)

  return (
    <section className="card" aria-labelledby="s-notif">
      <h2 id="s-notif">{t('notif.settings.title')}</h2>
      <p className="muted small">{t('notif.settings.hint')}</p>

      {loading ? (
        <LoadingState />
      ) : loadError ? (
        <ErrorState message={t('notif.settings.loadError')} detail={loadError} onRetry={load} />
      ) : (
        <>
          <div aria-live="polite">
            {notice && <p className="form-info">{notice}</p>}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>

          <fieldset className="settings-checks">
            <legend className="field-label">{t('notif.settings.kinds')}</legend>
            {kinds.map((k) => (
              <label key={k} className="check">
                <input type="checkbox" checked={!settings.muted_kinds.includes(k)} onChange={(e) => toggleKind(k, e.target.checked)} />
                {t(`notif.kind.${k}`)}
              </label>
            ))}
          </fieldset>

          <fieldset className="settings-checks">
            <legend className="field-label">{t('notif.settings.email')}</legend>
            <label className="check">
              <input type="checkbox" checked={settings.email_daily} onChange={(e) => save({ ...settings, email_daily: e.target.checked })} />
              {t('notif.settings.daily')}
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.email_urgent} onChange={(e) => save({ ...settings, email_urgent: e.target.checked })} />
              {t('notif.settings.urgentEmail')}
            </label>
            <p className="muted small">{t('notif.settings.emailNote', { email: profile?.email ?? '' })}</p>
          </fieldset>
        </>
      )}
    </section>
  )
}
