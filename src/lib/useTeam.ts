import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Label, Profile, Project } from './types'

/** Shared lookups used by several screens: team members, visible projects, labels. */
export function useLookups() {
  const [people, setPeople] = useState<Profile[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [labels, setLabels] = useState<Label[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setError(null)
    const [p, pr, l] = await Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('projects').select('id,name,color,pm_id,status,client_label,archived').order('name'),
      supabase.from('labels').select('id,name,color').order('name'),
    ])
    const err = p.error || pr.error || l.error
    if (err) setError(err.message)
    else {
      setPeople(p.data as Profile[])
      setProjects(pr.data as Project[])
      setLabels(l.data as Label[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { people, projects, labels, setLabels, error, loading, reload }
}
