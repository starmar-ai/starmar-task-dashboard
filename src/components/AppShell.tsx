import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useI18n } from '../lib/i18n'
import { Avatar } from './Chips'
import { QuickAddTask } from './QuickAddTask'
import { QuickSearch, isSearchShortcut } from './QuickSearch'
import { supabase } from '../lib/supabase'
import { useRequestsChanged } from '../lib/requestEvents'
import { purgeExpired } from '../lib/trash'
import { todayIn } from '../lib/dates'
import { useUnreadCount } from '../lib/notifications'

function NavIcon({ name }: { name: 'dashboard' | 'tasks' | 'projects' | 'calendar' | 'workload' | 'requests' | 'bell' | 'team' | 'trash' | 'settings' }) {
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
      {name === 'workload' && (
        <>
          <path d="M4 6h9M4 12h14M4 18h6" {...common} />
          <circle cx="17" cy="6" r="1.6" {...common} />
          <circle cx="21" cy="12" r="0.4" {...common} />
        </>
      )}
      {name === 'requests' && (
        <>
          <path d="M4.5 6.5a2 2 0 012-2h11a2 2 0 012 2v8a2 2 0 01-2 2H11l-4.5 3.5v-3.5a2 2 0 01-2-2z" {...common} />
          <path d="M8.5 10h7M8.5 13h4" {...common} />
        </>
      )}
      {name === 'bell' && (
        <>
          <path d="M6 16.5V11a6 6 0 0112 0v5.5l1.5 2h-15z" {...common} />
          <path d="M10 21a2.2 2.2 0 004 0" {...common} />
        </>
      )}
      {name === 'team' && (
        <>
          <circle cx="9" cy="8.5" r="3" {...common} />
          <path d="M3.5 19a5.5 5.5 0 0111 0M15.5 5.8a3 3 0 010 5.4M17.5 14.2a5.5 5.5 0 013 4.8" {...common} />
        </>
      )}
      {name === 'trash' && (
        <>
          <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5" {...common} />
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
  const [searching, setSearching] = useState(false)
  const location = useLocation()

  useEffect(() => setOpen(false), [location.pathname, location.search])

  // Open change requests waiting for this person's decision (their own requests do not count).
  const [pendingRequests, setPendingRequests] = useState(0)
  const myId = profile?.id
  const loadPending = useCallback(async () => {
    if (!myId) return
    const { count } = await supabase
      .from('change_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .neq('requester_id', myId)
    setPendingRequests(count ?? 0)
  }, [myId])
  useEffect(() => {
    loadPending()
  }, [loadPending, location.pathname])
  useRequestsChanged(loadPending)

  const unread = useUnreadCount(myId, location.pathname)
  const unreadLabel = unread > 0 ? t('nav.notificationsCount', { n: unread }) : t('nav.notifications')

  // Trash entries older than 30 days go for good once the signed-in user opens the app.
  const timezone = profile?.timezone
  useEffect(() => {
    if (timezone) purgeExpired(todayIn(timezone))
  }, [timezone])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isSearchShortcut(e)) return
      e.preventDefault()
      setSearching(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const isDark = profile?.theme === 'dark'

  return (
    <div className="shell">
      <header className="topbar">
        <span className="wordmark">{t('app.name')}</span>
        <Link to="/notifications" className="bell-link" aria-label={unreadLabel}>
          <NavIcon name="bell" />
          {unread > 0 && (
            <span className="nav-badge" aria-hidden="true">
              {unread}
            </span>
          )}
        </Link>
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
              <NavLink to="/notifications" className="nav-link" aria-label={unread > 0 ? unreadLabel : undefined}>
                <NavIcon name="bell" />
                {t('nav.notifications')}
                {unread > 0 && (
                  <span className="nav-badge" aria-hidden="true">
                    {unread}
                  </span>
                )}
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
            <li>
              <NavLink to="/workload" className="nav-link">
                <NavIcon name="workload" />
                {t('nav.workload')}
              </NavLink>
            </li>
            <li>
              <NavLink to="/requests" className="nav-link" aria-label={pendingRequests > 0 ? t('nav.requestsCount', { n: pendingRequests }) : undefined}>
                <NavIcon name="requests" />
                {t('nav.requests')}
                {pendingRequests > 0 && (
                  <span className="nav-badge" aria-hidden="true">
                    {pendingRequests}
                  </span>
                )}
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
              <NavLink to="/trash" className="nav-link">
                <NavIcon name="trash" />
                {t('nav.trash')}
              </NavLink>
            </li>
            <li>
              <NavLink to="/settings" className="nav-link">
                <NavIcon name="settings" />
                {t('nav.settings')}
              </NavLink>
            </li>
          </ul>
        </nav>

        <div className="sidebar-search-wrap">
          <button type="button" className="btn btn-secondary btn-sm sidebar-search" onClick={() => setSearching(true)}>
            {t('qs.open')}
            <kbd className="kbd">/</kbd>
          </button>
        </div>

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
      <QuickAddTask />
      {searching && <QuickSearch onClose={() => setSearching(false)} />}
    </div>
  )
}
