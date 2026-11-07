import type { Profile, Project } from './types'

export interface ProjectMember {
  project_id: string
  user_id: string
}

type Person = Pick<Profile, 'id' | 'role' | 'active'>

/** Same rule as user_can_see_project in the database: active, and admin, PM, or project member. */
export function canOpenProject(person: Person, project: Pick<Project, 'id' | 'pm_id'> | undefined, members: ProjectMember[]): boolean {
  if (person.active === false || !project) return false
  if (person.role === 'admin' || project.pm_id === person.id) return true
  return members.some((m) => m.project_id === project.id && m.user_id === person.id)
}

/**
 * People who can be picked as assignee or reviewer on a task in this project.
 * The current pick stays in the list so the select never silently changes it.
 */
export function pickablePeople<P extends Person>(
  people: P[],
  project: Pick<Project, 'id' | 'pm_id'> | undefined,
  members: ProjectMember[],
  keepIds: (string | null | undefined)[] = [],
): P[] {
  return people.filter((p) => canOpenProject(p, project, members) || keepIds.includes(p.id))
}

export type InviteState = 'active' | 'pending' | 'revoked'

export interface TeamStatusRow {
  user_id: string
  invited_at: string | null
  joined_at: string | null
  last_sign_in_at: string | null
}

export function inviteState(person: Pick<Profile, 'active'>, status: TeamStatusRow | undefined): InviteState {
  if (person.active === false) return 'revoked'
  if (status && !status.joined_at) return 'pending'
  return 'active'
}
