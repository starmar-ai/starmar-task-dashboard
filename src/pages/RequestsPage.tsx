import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { useAuth } from '../auth/AuthProvider'
import { todayIn } from '../lib/dates'
import { canDecide, needsReminder, type ChangeRequest } from '../lib/changeRequests'
import { useRequestsChanged } from '../lib/requestEvents'
import { useLookups } from '../lib/useTeam'
import type { Task } from '../lib/types'
import { ChangeRequestCard } from '../components/ChangeRequestCard'
import { EmptyState, ErrorState, LoadingState } from '../components/States'

type Tab = 'decide' | 'mine' | 'history'
const TABS: Tab[] = ['decide', 'mine', 'history']

export function RequestsPage() {
  const { t } = useI18n()
  const { profile } = useAuth()
  const lookups = useLookups()
  const timezone = profile?.timezone ?? 'Asia/Jakarta'
  const today = todayIn(timezone)
  const [tab, setTab] = useState<Tab>('decide')
  const [requests, setRequests] = useState<ChangeRequest[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    const { data, error } = await supabase.from('change_requests').select('*').order('created_at', { ascending: false })
    if (error) {
      setLoadError(error.message)
      setLoading(false)
      return
    }
    const list = data as ChangeRequest[]
    const ids = [...new Set(list.map((r) => r.task_id))]
    const taskRes = ids.length ? await supabase.from('tasks').select('*, task_labels(label_id)').in('id', ids) : { data: [], error: null }
    if (taskRes.error) setLoadError(taskRes.error.message)
    else {
      setRequests(list)
      setTasks(taskRes.data as Task[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])
  useRequestsChanged(load)

  const taskById = useMemo(() => new Map(tasks.map((x) => [x.id, x])), [tasks])
  const isAdmin = profile?.role === 'admin'

  const shown = useMemo(() => {
    if (tab === 'decide') return requests.filter((r) => r.status === 'pending' && canDecide(profile, r, taskById.get(r.task_id)))
    if (tab === 'mine') return requests.filter((r) => r.requester_id === profile?.id)
    return requests.filter((r) => r.status !== 'pending')
  }, [requests, tab, profile, taskById])
  const counts = useMemo(
    () => ({
      decide: requests.filter((r) => r.status === 'pending' && canDecide(profile, r, taskById.get(r.task_id))).length,
      mine: requests.filter((r) => r.status === 'pending' && r.requester_id === profile?.id).length,
    }),
    [requests, profile, taskById],
  )
  const stale = isAdmin ? requests.filter((r) => needsReminder(r, today, timezone)).length : 0

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t('requests.title')}</h1>
          <p className="muted">{t('requests.hint')}</p>
        </div>
        <fieldset className="segmented segmented-sm view-switch">
          <legend className="sr-only">{t('requests.tab.label')}</legend>
          {TABS.map((v) => (
            <label key={v} className={tab === v ? 'is-on' : ''}>
              <input type="radio" name="requests-tab" checked={tab === v} onChange={() => setTab(v)} />
              {t(`requests.tab.${v}`)}
              {v !== 'history' && counts[v] > 0 ? ` (${counts[v]})` : ''}
            </label>
          ))}
        </fieldset>
      </header>

      {stale > 0 && (
        <p className="form-info cr-stale-banner" role="status">
          {t('cr.staleBanner', { n: stale })}
        </p>
      )}

      {loading || lookups.loading ? (
        <LoadingState />
      ) : loadError || lookups.error ? (
        <ErrorState message={t('requests.loadError')} detail={loadError ?? lookups.error ?? undefined} onRetry={load} />
      ) : shown.length === 0 ? (
        <EmptyState>{t(`requests.empty.${tab}`)}</EmptyState>
      ) : (
        <ul className="cr-list">
          {shown.map((r) => (
            <ChangeRequestCard
              key={r.id}
              request={r}
              task={taskById.get(r.task_id)}
              people={lookups.people}
              showTask
            />
          ))}
        </ul>
      )}
    </div>
  )
}
