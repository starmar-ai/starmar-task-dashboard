import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Label, Profile, Project } from './types'
import type { ProjectMember } from './team'

/** Shared lookups used by several screens: team members, visible projects, project access, labels. */
export function useLookups() {
  const [people, setPeople] = useState<Profile[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [labels, setLabels] = useState<Label[]>([])
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setError(null)
    const [p, pr, l, m] = await Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('projects').select('id,name,color,pm_id,status,client_label,archived').order('name'),
      supabase.from('labels').select('id,name,color').order('name'),
      supabase.from('project_members').select('project_id,user_id'),
    ])
    const err = p.error || pr.error || l.error || m.error
    if (err) setError(err.message)
    else {
      setPeople(p.data as Profile[])
      setProjects(pr.data as Project[])
      setLabels(l.data as Label[])
      setMembers(m.data as ProjectMember[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { people, projects, labels, setLabels, members, error, loading, reload }
}
