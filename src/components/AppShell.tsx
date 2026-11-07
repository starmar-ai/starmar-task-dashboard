import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../lib/i18n'
import { Avatar } from './Chips'

function NavIcon({ name }: { name: 'dashboard' | 'tasks' | 'projects' | 'calendar' | 'team' | 'settings' }) {
  const common = { stroke: 'currentColor', strokeWidth: 2.2, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      {name === 'dashboard' && (
        <>
          <path d="M4 19.5h16" {...common} />
          <path d="M7 16v-4M12 16V7M17 16v-6" {...common} />
        </>
      )}
      {name === 'tasks' && (
        <>
          <rect x="3.5" y="4" width="17" height="16" rx="3" {...common} />
          <path d="M7.5 9.5l1.8 1.8 3.2-3.3M7.5 15.5h9" {...common} />
        </>
      )}
      {name === 'projects' && (
        <>
          <path d="M3.5 7.5a2 2 0 012-2h4l2 2h7a2 2 0 012 2v8a2 2 0 01-2 2h-13a2 2 0 01-2-2z" {...common} />
        </>
      )}
      {name === 'calendar' && (
        <>
          <rect x="3.5" y="5" width="17" height="15" rx="3" {...common} />
          <path d="M3.5 10h17M8 3v4M16 3v4" {...common} />
        </>
      )}
      {name === 'team' && (
        <>
          <circle cx="9" cy="8.5" r="3" {...common} />
          <path d="M3.5 19a5.5 5.5 0 0111 0M15.5 5.8a3 3 0 010 5.4M17.5 14.2a5.5 5.5 0 013 4.8" {...common} />
        </>
      )}
      {name === 'settings' && (
        <>
          <path d="M4 7h10M18 7h2M4 17h4M12 17h8" {...common} />
          <circle cx="16" cy="7" r="2" {...common} />
          <circle cx="10" cy="17" r="2" {...common} />
        </>
      )}
    </svg>
  )
}

export function AppShell() {
  const { profile, signOut, updateProfile } = useAuth()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const location = useLocation()

  useEffect(() => setOpen(false), [location.pathname, location.search])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const isDark = profile?.theme === 'dark'

  return (
    <div className="shell">
      <header className="topbar">
        <span className="wordmark">{t('app.name')}</span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          aria-expanded={open}
          aria-controls="sidebar"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? t('nav.close') : t('nav.menu')}
        </button>
      </header>

      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />}

      <aside id="sidebar" className={`sidebar ${open ? 'is-open' : ''}`}>
        <div className="sidebar-brand">
          <span className="wordmark">{t('app.name')}</span>
        </div>
        <nav aria-label={t('nav.main')}>
          <ul className="nav-list">
            <li>
              <NavLink to="/dashboard" className="nav-link">
                <NavIcon name="dashboard" />
                {t('nav.dashboard')}
              </NavLink>
            </li>
            <li>
              <NavLink to="/tasks" className="nav-link">
                <NavIcon name="tasks" />
                {t('nav.tasks')}
              </NavLink>
            </li>
            <li>
              <NavLink to="/projects" className="nav-link">
                <NavIcon name="projects" />
                {t('nav.projects')}
              </NavLink>
            </li>
            <li>
              <NavLink to="/calendar" className="nav-link">
                <NavIcon name="calendar" />
                {t('nav.calendar')}
              </NavLink>
            </li>
            {profile?.role === 'admin' && (
              <li>
                <NavLink to="/team" className="nav-link">
                  <NavIcon name="team" />
                  {t('nav.team')}
                </NavLink>
              </li>
            )}
            <li>
              <NavLink to="/settings" className="nav-link">
                <NavIcon name="settings" />
                {t('nav.settings')}
              </NavLink>
            </li>
          </ul>
        </nav>

        <div className="sidebar-foot">
          {profile && (
            <div className="me">
              <Avatar name={profile.full_name || profile.email} />
              <div className="me-text">
                <span className="me-name">{profile.full_name || profile.email}</span>
                <span className="me-role">{t(`role.${profile.role}`)}</span>
              </div>
            </div>
          )}
          <div className="sidebar-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => updateProfile({ theme: isDark ? 'light' : 'dark' })}
            >
              {isDark ? t('theme.toLight') : t('theme.toDark')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={signOut}>
              {t('nav.signOut')}
            </button>
          </div>
        </div>
      </aside>

      <main className="main" id="main">
        <Outlet />
      </main>
    </div>
  )
}
