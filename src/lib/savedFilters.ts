import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { normalizeQuery } from './taskFilters'

export interface SavedFilter {
  id: string
  name: string
  query: string
}

/** The signed-in person's favorite filters. RLS keeps other people's rows out. */
export function useSavedFilters() {
  const [filters, setFilters] = useState<SavedFilter[]>([])
  const [error, setError] = useState<{ message?: string; code?: string } | null>(null)

  const reload = useCallback(async () => {
    const { data, error: err } = await supabase.from('saved_filters').select('id,name,query').order('created_at')
    if (err) setError(err)
    else {
      setError(null)
      setFilters(data as SavedFilter[])
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  async function save(name: string, query: string) {
    const { error: err } = await supabase.from('saved_filters').insert({ name: name.trim(), query: normalizeQuery(query) })
    if (!err) await reload()
    return err
  }

  async function rename(id: string, name: string) {
    const { error: err } = await supabase.from('saved_filters').update({ name: name.trim() }).eq('id', id)
    if (!err) await reload()
    return err
  }

  async function remove(id: string) {
    const { error: err } = await supabase.from('saved_filters').delete().eq('id', id)
    if (!err) await reload()
    return err
  }

  return { filters, error, save, rename, remove }
}
