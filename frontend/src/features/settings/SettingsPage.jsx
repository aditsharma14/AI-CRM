// Profile, organization, teams & members, roles, email templates tabs.
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2, Send } from 'lucide-react'
import { useSession } from '../../context/SessionContext.jsx'
import { api } from '../../api/client.js'
import { Tabs, Button, Badge, Loader, EmptyState } from '../../components/ui.jsx'
import { FormField, inputClasses } from '../../components/FormField.jsx'
import { ConfirmDialog } from '../../components/Modal.jsx'
import { ErrorAlert } from '../../components/ErrorAlert.jsx'
import { useDisclosure } from '../../hooks.js'
import { canManageMember, manageableRoles } from '../../lib/constants.js'

const ROLE_VARIANT = { owner: 'success', admin: 'warning', manager: 'default', member: 'default' }
// Least privilege first, so the invite form's default ('member') is the first option.
const ROLE_LABEL = { member: 'Member', manager: 'Manager', admin: 'Admin' }

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

const profileSchema = z.object({ name: z.string().trim().min(1, 'Name is required') })
const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] })

function ProfileTab() {
  const { user, updateLocalUser } = useSession()
  const [savedName, setSavedName] = useState(false)
  const [savedPassword, setSavedPassword] = useState(false)

  const profileForm = useForm({ resolver: zodResolver(profileSchema), defaultValues: { name: user?.name ?? '' } })
  const updateProfile = useMutation({
    mutationFn: async (values) => (await api.patch('/org/me', values)).data.data,
    onSuccess: (updatedUser) => {
      updateLocalUser({ name: updatedUser.name })
      setSavedName(true)
    },
  })

  const passwordForm = useForm({ resolver: zodResolver(passwordSchema) })
  const changePassword = useMutation({
    mutationFn: (values) => api.patch('/org/me/password', values),
    onSuccess: () => {
      passwordForm.reset()
      setSavedPassword(true)
    },
  })

  return (
    <div className="flex max-w-md flex-col gap-8">
      <form onSubmit={profileForm.handleSubmit((v) => updateProfile.mutate(v))}>
        <h2 className="mb-4 font-serif text-lg font-semibold">Your name</h2>
        <FormField label="Name" error={profileForm.formState.errors.name}>
          <input className={inputClasses(profileForm.formState.errors.name)} {...profileForm.register('name')} />
        </FormField>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={updateProfile.isPending}>
            Save name
          </Button>
          {savedName && <span className="text-sm text-success">Saved.</span>}
        </div>
      </form>

      <form onSubmit={passwordForm.handleSubmit((v) => changePassword.mutate(v))}>
        <h2 className="mb-4 font-serif text-lg font-semibold">Change password</h2>
        <FormField label="Current password" error={passwordForm.formState.errors.currentPassword}>
          <input type="password" className={inputClasses(passwordForm.formState.errors.currentPassword)} {...passwordForm.register('currentPassword')} />
        </FormField>
        <FormField label="New password" error={passwordForm.formState.errors.newPassword} hint="At least 8 characters.">
          <input type="password" className={inputClasses(passwordForm.formState.errors.newPassword)} {...passwordForm.register('newPassword')} />
        </FormField>
        <FormField label="Confirm new password" error={passwordForm.formState.errors.confirmPassword}>
          <input type="password" className={inputClasses(passwordForm.formState.errors.confirmPassword)} {...passwordForm.register('confirmPassword')} />
        </FormField>
        <ErrorAlert error={changePassword.error} />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={changePassword.isPending}>
            Change password
          </Button>
          {savedPassword && <span className="text-sm text-success">Password changed. You'll stay signed in on this device.</span>}
        </div>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

const orgSchema = z.object({ name: z.string().trim().min(2, 'Organization name is required') })

function OrganizationTab() {
  const { can } = useSession()
  const queryClient = useQueryClient()
  const { data: org, isLoading } = useQuery({ queryKey: ['org'], queryFn: async () => (await api.get('/org')).data.data })
  const canManage = can('org', 'manage')

  const form = useForm({ resolver: zodResolver(orgSchema), values: { name: org?.name ?? '' } })
  const updateOrg = useMutation({
    mutationFn: (values) => api.patch('/org', values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['org'] }),
  })

  if (isLoading) return <Loader className="h-6 w-6" />

  return (
    <div className="max-w-md">
      <form onSubmit={form.handleSubmit((v) => updateOrg.mutate(v))}>
        <h2 className="mb-4 font-serif text-lg font-semibold">Organization name</h2>
        <FormField label="Name" error={form.formState.errors.name}>
          <input disabled={!canManage} className={inputClasses(form.formState.errors.name)} {...form.register('name')} />
        </FormField>
        {canManage ? (
          <Button type="submit" disabled={updateOrg.isPending}>
            Save
          </Button>
        ) : (
          <p className="text-sm text-muted dark:text-muted-dark">Only the org owner can rename the organization.</p>
        )}
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Members & teams
// ---------------------------------------------------------------------------

const inviteSchema = z.object({ email: z.string().trim().email(), role: z.enum(['admin', 'manager', 'member']) })

function MembersTab() {
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
  const { data: teams } = useQuery({ queryKey: ['org', 'teams'], queryFn: async () => (await api.get('/org/teams')).data.data })

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
            <input className={inputClasses(inviteForm.formState.errors.email)} {...inviteForm.register('email')} placeholder="teammate@company.com" />
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
                  {team.name} <span className="text-muted dark:text-muted-dark">· {team.memberIds?.length ?? 0} members</span>
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

// ---------------------------------------------------------------------------
// Pipeline & email templates
// ---------------------------------------------------------------------------

const templateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  subject: z.string().trim().min(1, 'Subject is required'),
  body: z.string().trim().min(1, 'Body is required'),
})

function PipelineTab() {
  const { can } = useSession()
  const queryClient = useQueryClient()
  const canConfigure = can('pipeline', 'configure')

  const { data: stages, isLoading } = useQuery({
    queryKey: ['org', 'pipeline-stages'],
    queryFn: async () => (await api.get('/org/pipeline-stages')).data.data,
  })
  const [draftStages, setDraftStages] = useState(null)
  const activeStages = draftStages ?? stages ?? []

  const saveStages = useMutation({
    mutationFn: (payload) => api.patch('/org/pipeline-stages', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org', 'pipeline-stages'] })
      setDraftStages(null)
    },
  })

  const { data: templates } = useQuery({
    queryKey: ['org', 'email-templates'],
    queryFn: async () => (await api.get('/org/email-templates')).data.data,
  })
  const templateForm = useForm({ resolver: zodResolver(templateSchema) })
  const createTemplate = useMutation({
    mutationFn: (values) => api.post('/org/email-templates', values),
    onSuccess: () => {
      templateForm.reset({ name: '', subject: '', body: '' })
      queryClient.invalidateQueries({ queryKey: ['org', 'email-templates'] })
    },
  })
  const [templateToDelete, setTemplateToDelete] = useState(null)
  const confirmDeleteTemplate = useDisclosure()
  const deleteTemplate = useMutation({
    mutationFn: (id) => api.delete(`/org/email-templates/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['org', 'email-templates'] }),
  })

  if (isLoading) return <Loader className="h-6 w-6" />

  const renameStage = (key, label) => {
    setDraftStages(activeStages.map((s) => (s.key === key ? { ...s, label } : s)))
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="mb-3 font-serif text-lg font-semibold">Pipeline stages</h2>
        <p className="mb-3 text-sm text-muted dark:text-muted-dark">
          These labels show up everywhere a deal's stage is displayed. The <code>won</code>/<code>lost</code> stages are what trigger a
          deal closing — only their labels can be changed.
        </p>
        <div className="flex flex-col gap-2">
          {activeStages
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((stage) => (
              <div key={stage.key} className="flex items-center gap-2">
                <input
                  disabled={!canConfigure}
                  value={stage.label}
                  onChange={(e) => renameStage(stage.key, e.target.value)}
                  className={`${inputClasses(false)} max-w-xs`}
                />
                <span className="font-mono text-xs text-muted dark:text-muted-dark">{stage.key}</span>
              </div>
            ))}
        </div>
        {canConfigure && draftStages && (
          <Button className="mt-3" disabled={saveStages.isPending} onClick={() => saveStages.mutate(draftStages)}>
            Save stage names
          </Button>
        )}
      </div>

      <div>
        <h2 className="mb-3 font-serif text-lg font-semibold">Email templates</h2>
        {canConfigure && (
          <form
            onSubmit={templateForm.handleSubmit((v) => createTemplate.mutate(v))}
            className="mb-4 flex flex-col gap-3 rounded-lg border border-border bg-card p-4 dark:border-border-dark dark:bg-card-dark"
          >
            <FormField label="Name" error={templateForm.formState.errors.name}>
              <input className={inputClasses(templateForm.formState.errors.name)} {...templateForm.register('name')} />
            </FormField>
            <FormField label="Subject" error={templateForm.formState.errors.subject}>
              <input className={inputClasses(templateForm.formState.errors.subject)} {...templateForm.register('subject')} />
            </FormField>
            <FormField label="Body" error={templateForm.formState.errors.body}>
              <textarea rows={3} className={inputClasses(templateForm.formState.errors.body)} {...templateForm.register('body')} />
            </FormField>
            <Button type="submit" disabled={createTemplate.isPending} className="self-start">
              Add template
            </Button>
          </form>
        )}
        {templates?.length ? (
          <ul className="flex flex-col gap-2">
            {templates.map((t) => (
              <li key={t._id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm dark:border-border-dark">
                <div>
                  <p className="font-medium">{t.name}</p>
                  <p className="text-xs text-muted dark:text-muted-dark">{t.subject}</p>
                </div>
                {canConfigure && (
                  <button
                    type="button"
                    onClick={() => {
                      setTemplateToDelete(t)
                      confirmDeleteTemplate.open()
                    }}
                    className="text-muted hover:text-danger dark:text-muted-dark"
                    aria-label={`Delete template ${t.name}`}
                  >
                    <Trash2 size={16} strokeWidth={1.75} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No email templates yet" description="Templates you create for AI email generation will show up here." />
        )}
      </div>

      <ConfirmDialog
        isOpen={confirmDeleteTemplate.isOpen}
        onClose={confirmDeleteTemplate.close}
        onConfirm={() => deleteTemplate.mutate(templateToDelete._id)}
        title="Delete this template?"
        description={`"${templateToDelete?.name}" will be permanently removed.`}
        confirmLabel="Delete"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------

export default function SettingsPage() {
  const [tab, setTab] = useState('profile')

  const tabs = [
    { key: 'profile', label: 'Profile' },
    { key: 'organization', label: 'Organization' },
    { key: 'members', label: 'Members & Teams' },
    { key: 'pipeline', label: 'Pipeline & Templates' },
  ]

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-serif text-xl font-semibold">Settings</h1>
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      <div className="pt-2">
        {tab === 'profile' && <ProfileTab />}
        {tab === 'organization' && <OrganizationTab />}
        {tab === 'members' && <MembersTab />}
        {tab === 'pipeline' && <PipelineTab />}
      </div>
    </div>
  )
}
