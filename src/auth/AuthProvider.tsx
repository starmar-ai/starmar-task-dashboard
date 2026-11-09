import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/types'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  profileError: string | null
  needsPassword: boolean
  setNeedsPassword: (v: boolean) => void
  refreshProfile: () => Promise<void>
  updateProfile: (patch: Partial<Profile>) => Promise<string | null>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

// Invite and recovery links land with a token in the URL hash; those users must set a password first.
// The flag is kept in sessionStorage because supabase-js clears the hash right after reading it,
// so a reload before the password is saved would otherwise skip the "Buat password" screen.
const PENDING_KEY = 'starmar-needs-password'
function readPending(): boolean {
  try {
    return sessionStorage.getItem(PENDING_KEY) === '1'
  } catch {
    return false
  }
}
export function setPendingPassword(v: boolean) {
  try {
    if (v) sessionStorage.setItem(PENDING_KEY, '1')
    else sessionStorage.removeItem(PENDING_KEY)
  } catch {
    /* storage can be blocked; the in-memory flag still works for this load */
  }
}
const arrivedFromEmailLink = /type=(invite|recovery|signup|magiclink)/.test(window.location.hash)
if (arrivedFromEmailLink) setPendingPassword(true)

/** An invite or reset link that was opened already (email scanners do this) or has expired comes back with an error in the URL. */
export const emailLinkError: 'expired' | 'other' | null = (() => {
  const raw = `${window.location.hash}&${window.location.search}`
  if (!/error(_code|_description)?=/.test(raw)) return null
  return /otp_expired|expired|invalid/i.test(raw) ? 'expired' : 'other'
})()

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [needsPassword, setNeedsPassword] = useState(arrivedFromEmailLink || readPending())

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (error) {
      setProfileError(error.message)
      setProfile(null)
    } else if (!data) {
      setProfileError('missing')
      setProfile(null)
    } else {
      setProfileError(null)
      setProfile(data as Profile)
    }
  }, [])

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      if (data.session) await loadProfile(data.session.user.id)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      if (event === 'PASSWORD_RECOVERY') {
        setPendingPassword(true)
        setNeedsPassword(true)
      }
      if (event === 'SIGNED_IN' && next) {
        // Run outside the auth callback; supabase-js warns against awaiting inside it.
        setTimeout(() => loadProfile(next.user.id), 0)
      }
      if (event === 'SIGNED_OUT') {
        setProfile(null)
        setPendingPassword(false)
        setNeedsPassword(false)
      }
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const refreshProfile = useCallback(async () => {
    if (session) await loadProfile(session.user.id)
  }, [session, loadProfile])

  const updateProfile = useCallback(
    async (patch: Partial<Profile>) => {
      if (!profile) return 'no profile'
      const previous = profile
      setProfile({ ...profile, ...patch })
      const { error } = await supabase.from('profiles').update(patch).eq('id', profile.id)
      if (error) {
        setProfile(previous)
        return error.message
      }
      return null
    },
    [profile],
  )

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }, [])

  return (
    <AuthContext.Provider
      value={{ session, profile, loading, profileError, needsPassword, setNeedsPassword, refreshProfile, updateProfile, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
