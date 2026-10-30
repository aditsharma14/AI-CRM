// Settings shell: Profile, Organization, Members & Teams, and Pipeline & Templates tabs, one file each.
import { useState } from 'react'

import { Tabs } from '../../components/ui.jsx'
import MembersTab from './MembersTab.jsx'
import OrganizationTab from './OrganizationTab.jsx'
import PipelineTab from './PipelineTab.jsx'
import ProfileTab from './ProfileTab.jsx'

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
