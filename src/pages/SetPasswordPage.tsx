import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useAuth } from '../auth/AuthProvider'

export function SetPasswordPage() {
  const { t } = useI18n()
  const { setNeedsPassword } = useAuth()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (pw.length < 8) return setError(t('setPassword.tooShort'))
    if (pw !== pw2) return setError(t('setPassword.mismatch'))
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return setError(error.message)
    history.replaceState(null, '', '/tasks')
    setNeedsPassword(false)
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={onSubmit}>
        <span className="wordmark wordmark-lg">{t('app.name')}</span>
        <h1>{t('setPassword.title')}</h1>
        <p className="muted">{t('setPassword.subtitle')}</p>
        <div className="field">
          <label htmlFor="pw">{t('setPassword.new')}</label>
          <input id="pw" type="password" autoComplete="new-password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pw2">{t('setPassword.confirm')}</label>
          <input id="pw2" type="password" autoComplete="new-password" minLength={8} required value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? t('common.saving') : t('setPassword.submit')}
        </button>
      </form>
    </main>
  )
}
