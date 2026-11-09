import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { emailLinkError } from '../auth/AuthProvider'

type Mode = 'login' | 'forgot' | 'invited'

export function LoginPage() {
  const { t } = useI18n()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(
    emailLinkError === 'expired' ? t('login.linkExpired') : emailLinkError ? t('login.linkError') : null,
  )

  function go(next: Mode) {
    setMode(next)
    setError(null)
    setInfo(null)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setInfo(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setError(error.status === 400 ? t('login.failed') : error.message)
  }

  // Both "forgot password" and "no account yet" send the same email-only link; it only reaches emails that were invited.
  async function onSendLink(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setInfo(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/`,
    })
    setBusy(false)
    if (error) setError(error.message)
    else setInfo(t('login.forgotSent'))
  }

  const emailField = (
    <div className="field">
      <label htmlFor="email">{t('login.email')}</label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        autoFocus
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="email@example.com"
      />
    </div>
  )

  const messages = (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {info && (
        <p className="form-info" role="status">
          {info}
        </p>
      )}
    </>
  )

  if (mode !== 'login') {
    const invited = mode === 'invited'
    return (
      <main className="auth-page">
        <form className="auth-card" onSubmit={onSendLink}>
          <span className="wordmark wordmark-lg">{t('app.name')}</span>
          <h1>{invited ? t('login.noAccountTitle') : t('login.forgotTitle')}</h1>
          <p className="muted">{invited ? t('login.noAccountHint') : t('login.forgotHint')}</p>
          {emailField}
          {messages}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? t('login.sending') : t('login.sendLink')}
          </button>
          <button type="button" className="btn btn-ghost btn-block" onClick={() => go('login')}>
            {t('login.back')}
          </button>
        </form>
      </main>
    )
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={onSubmit}>
        <span className="wordmark wordmark-lg">{t('app.name')}</span>
        <h1>{t('login.title')}</h1>
        <p className="muted">{t('login.subtitle')}</p>
        {emailField}
        <div className="field">
          <label htmlFor="password">{t('login.password')}</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {messages}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? t('login.submitting') : t('login.submit')}
        </button>
        <button type="button" className="btn btn-ghost btn-block" onClick={() => go('forgot')}>
          {t('login.forgot')}
        </button>
        <button type="button" className="btn btn-ghost btn-block" onClick={() => go('invited')}>
          {t('login.noAccount')}
        </button>
      </form>
    </main>
  )
}
