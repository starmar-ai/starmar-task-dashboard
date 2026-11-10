import { useEffect } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { I18nProvider, useI18n } from './lib/i18n'
import { isConfigured } from './lib/supabase'
import { AppShell } from './components/AppShell'
import { ErrorState, LoadingState } from './components/States'
import { LoginPage } from './pages/LoginPage'
import { SetPasswordPage } from './pages/SetPasswordPage'
import { DashboardPage } from './pages/DashboardPage'
import { TasksPage } from './pages/TasksPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { SettingsPage } from './pages/SettingsPage'
import { TrashPage } from './pages/TrashPage'
import { CalendarPage } from './pages/CalendarPage'
import { TeamPage } from './pages/TeamPage'
import { WorkloadPage } from './pages/WorkloadPage'
import { RequestsPage } from './pages/RequestsPage'

function useThemeSync(theme: 'light' | 'dark' | undefined) {
  useEffect(() => {
    if (!theme) return
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('starmar-theme', theme)
    } catch {
      /* storage can be blocked; the profile still holds the choice */
    }
  }, [theme])
}

/** Clicking anywhere in a date field opens the calendar, not only its small icon. */
function useDatePickerOnClick() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = e.target
      if (!(el instanceof HTMLInputElement) || el.type !== 'date' || el.disabled || el.readOnly) return
      try {
        el.showPicker()
      } catch {
        /* the browser can refuse without a user gesture; the field still works by typing */
      }
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])
}

function NotFound() {
  const { t } = useI18n()
  return (
    <div className="page">
      <h1>{t('notFound.title')}</h1>
      <Link to="/dashboard" className="btn btn-secondary">
        {t('notFound.back')}
      </Link>
    </div>
  )
}

function Gate() {
  const { session, profile, loading, profileError, needsPassword, signOut } = useAuth()
  const { t } = useI18n()
  useThemeSync(profile?.theme)
  useDatePickerOnClick()

  if (loading) return <LoadingState />
  if (!session) return <LoginPage />
  if (needsPassword) return <SetPasswordPage />
  if (!profile) {
    if (!profileError) return <LoadingState />
    return (
      <main className="auth-page">
        <div className="auth-card">
          <ErrorState message={t('profile.missing')} detail={profileError === 'missing' ? undefined : profileError} />
          <button type="button" className="btn btn-secondary" onClick={signOut}>
            {t('nav.signOut')}
          </button>
        </div>
      </main>
    )
  }

  if (profile.active === false) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <span className="wordmark wordmark-lg">{t('app.name')}</span>
          <h1>{t('access.revokedTitle')}</h1>
          <p>{t('access.revokedBody')}</p>
          <button type="button" className="btn btn-secondary" onClick={signOut}>
            {t('nav.signOut')}
          </button>
        </div>
      </main>
    )
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="workload" element={<WorkloadPage />} />
        <Route path="requests" element={<RequestsPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="trash" element={<TrashPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

function LocalizedApp() {
  const { profile } = useAuth()
  return (
    <I18nProvider locale={profile?.locale ?? 'id'}>
      <Gate />
    </I18nProvider>
  )
}

function SetupMissing() {
  const { t } = useI18n()
  return (
    <main className="auth-page">
      <div className="auth-card">
        <span className="wordmark wordmark-lg">{t('app.name')}</span>
        <h1>{t('setup.title')}</h1>
        <p>{t('setup.body')}</p>
      </div>
    </main>
  )
}

export default function App() {
  if (!isConfigured) return <SetupMissing />
  return (
    <BrowserRouter>
      <AuthProvider>
        <LocalizedApp />
      </AuthProvider>
    </BrowserRouter>
  )
}
