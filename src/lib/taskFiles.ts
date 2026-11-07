import { supabase } from './supabase'
import { FILES_BUCKET } from './files'

/**
 * Deleting a task removes its attachment rows by cascade, but not the stored files.
 * Call this before deleting tasks (or a project) so the files do not keep using the storage quota.
 */
export async function removeFilesOfTasks(filter: { taskId: string } | { projectId: string }) {
  const query =
    'taskId' in filter
      ? supabase.from('task_attachments').select('storage_path').eq('task_id', filter.taskId)
      : supabase.from('task_attachments').select('storage_path, tasks!inner(project_id)').eq('tasks.project_id', filter.projectId)
  const { data, error } = await query
  if (error) return { error }
  const paths = (data as { storage_path: string }[]).map((r) => r.storage_path)
  if (!paths.length) return { error: null }
  const { error: removeErr } = await supabase.storage.from(FILES_BUCKET).remove(paths)
  return { error: removeErr }
}
