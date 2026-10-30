// Settings → Members & Teams: invites, member roles and removal, teams.
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { api } from '../../api/client.js'
import { ErrorAlert } from '../../components/ErrorAlert.jsx'
import { FormField, inputClasses } from '../../components/FormField.jsx'
import { ConfirmDialog } from '../../components/Modal.jsx'
import { Badge, Button, Loader } from '../../components/ui.jsx'
import { useSession } from '../../context/SessionContext.jsx'
import { useDisclosure } from '../../hooks.js'
import { canManageMember, manageableRoles } from '../../lib/constants.js'

const ROLE_VARIANT = { owner: 'success', admin: 'warning', manager: 'default', member: 'default' }
// Least privilege first, so the invite form's default ('member') is the first option.
const ROLE_LABEL = { member: 'Member', manager: 'Manager', admin: 'Admin' }

const inviteSchema = z.object({ email: z.string().trim().email(), role: z.enum(['admin', 'manager', 'member']) })

export default function MembersTab() {
  const { user, can } = useSession()
  const queryClient = useQueryClient()
  const canManage = can('members', 'manage')
  // Same rules as the backend's membership.js: only the owner grants or
  // manages admin, and the owner row and your own row get no controls.
  const assignableRoles = manageableRoles(user)
  const roleOptions = Object.entries(ROLE_LABEL)
    .filter(([role]) => assignableRoles.includes(role))
    .map(([role, label]) => (
      <option key={role} value={role}>
        {label}
      </option>
    ))
  const invalidateMembers = () => queryClient.invalidateQueries({ queryKey: ['org', 'members'] })

  const [memberToRemove, setMemberToRemove] = useState(null)
  const confirmRemoveMember = useDisclosure()
  const [teamToDelete, setTeamToDelete] = useState(null)
  const confirmDeleteTeam = useDisclosure()

  const { data: members, isLoading } = useQuery({
    queryKey: ['org', 'members'],
    queryFn: async () => (await api.get('/org/members')).data.data,
  })
  const { data: teams } = useQuery({
    queryKey: ['org', 'teams'],
    queryFn: async () => (await api.get('/org/teams')).data.data,
  })

  const inviteForm = useForm({ resolver: zodResolver(inviteSchema), defaultValues: { role: 'member' } })
  const [inviteSent, setInviteSent] = useState(false)
  const invite = useMutation({
    mutationFn: (values) => api.post('/org/members/invite', values),
    onSuccess: () => {
      inviteForm.reset({ email: '', role: 'member' })
      setInviteSent(true)
    },
  })

  const updateRole = useMutation({
    mutationFn: ({ id, role }) => api.patch(`/org/members/${id}/role`, { role }),
    onSuccess: invalidateMembers,
  })
  const removeMember = useMutation({
    mutationFn: (id) => api.delete(`/org/members/${id}`),
    onSuccess: invalidateMembers,
  })

  const [teamName, setTeamName] = useState('')
  const createTeam = useMutation({
    mutationFn: (name) => api.post('/org/teams', { name }),
    onSuccess: () => {
      setTeamName('')
      queryClient.invalidateQueries({ queryKey: ['org', 'teams'] })
    },
  })
  const deleteTeam = useMutation({
    mutationFn: (id) => api.delete(`/org/teams/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['org', 'teams'] }),
  })

  return (
    <div className="flex flex-col gap-8">
      {canManage && (
        <form
          onSubmit={inviteForm.handleSubmit((v) => invite.mutate(v))}
          className="flex items-end gap-3 rounded-lg border border-border bg-card p-4 dark:border-border-dark dark:bg-card-dark"
        >
          <FormField label="Invite by email" error={inviteForm.formState.errors.email} hint={null}>
            <input
              className={inputClasses(inviteForm.formState.errors.email)}
              {...inviteForm.register('email')}
              placeholder="teammate@company.com"
            />
          </FormField>
          <FormField label="Role" htmlFor="invite-role">
            <select id="invite-role" className={inputClasses(false)} {...inviteForm.register('role')}>
              {roleOptions}
            </select>
          </FormField>
          <Button type="submit" disabled={invite.isPending} className="mb-4">
            <Send size={14} strokeWidth={1.75} />
            Invite
          </Button>
        </form>
      )}
      {inviteSent && <p className="text-sm text-success">Invite sent — they'll get a link to join.</p>}
      {/* A refused change (e.g. 403 from the policy) must be visible: the
          role select is controlled by server data, so it just snaps back. */}
      <ErrorAlert error={updateRole.error ?? removeMember.error ?? invite.error} />

      <div>
        <h2 className="mb-3 font-serif text-lg font-semibold">Members</h2>
        {isLoading ? (
          <Loader className="h-5 w-5" />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border dark:border-border-dark">
            {members.map((member) => (
              <div
                key={member._id}
                className="flex items-center justify-between border-b border-border px-4 py-3 last:border-0 dark:border-border-dark"
              >
                <div>
                  <p className="text-sm font-medium">{member.name}</p>
                  <p className="text-xs text-muted dark:text-muted-dark">{member.email}</p>
                </div>
                <div className="flex items-center gap-3">
                  {canManageMember(user, member) ? (
                    <select
                      value={member.role}
                      onChange={(e) => updateRole.mutate({ id: member._id, role: e.target.value })}
                      aria-label={`Role for ${member.name}`}
                      className={inputClasses(false)}
                    >
                      {roleOptions}
                    </select>
                  ) : (
                    <Badge variant={ROLE_VARIANT[member.role]}>{member.role}</Badge>
                  )}
                  {canManageMember(user, member) && (
                    <button
                      type="button"
                      onClick={() => {
                        setMemberToRemove(member)
                        confirmRemoveMember.open()
                      }}
                      className="text-muted hover:text-danger dark:text-muted-dark"
                      aria-label={`Remove ${member.name}`}
                    >
                      <Trash2 size={16} strokeWidth={1.75} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 font-serif text-lg font-semibold">Teams</h2>
        {canManage && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (teamName.trim()) createTeam.mutate(teamName.trim())
            }}
            className="mb-3 flex gap-2"
          >
            <input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="New team name…"
              className={`${inputClasses(false)} max-w-xs`}
            />
            <Button type="submit" disabled={createTeam.isPending || !teamName.trim()}>
              Add team
            </Button>
          </form>
        )}
        {teams?.length ? (
          <ul className="flex flex-col gap-2">
            {teams.map((team) => (
              <li
                key={team._id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm dark:border-border-dark"
              >
                <span>
                  {team.name}{' '}
                  <span className="text-muted dark:text-muted-dark">· {team.memberIds?.length ?? 0} members</span>
                </span>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => {
                      setTeamToDelete(team)
                      confirmDeleteTeam.open()
                    }}
                    className="text-muted hover:text-danger dark:text-muted-dark"
                    aria-label={`Delete team ${team.name}`}
                  >
                    <Trash2 size={16} strokeWidth={1.75} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted dark:text-muted-dark">No teams yet.</p>
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmRemoveMember.isOpen}
        onClose={confirmRemoveMember.close}
        onConfirm={() => removeMember.mutate(memberToRemove._id)}
        title="Remove this member?"
        description={`"${memberToRemove?.name}" will lose access to this organization immediately.`}
        confirmLabel="Remove"
      />
      <ConfirmDialog
        isOpen={confirmDeleteTeam.isOpen}
        onClose={confirmDeleteTeam.close}
        onConfirm={() => deleteTeam.mutate(teamToDelete._id)}
        title="Delete this team?"
        description={`"${teamToDelete?.name}" will be removed. This doesn't remove any members from the org.`}
        confirmLabel="Delete"
      />
    </div>
  )
}
