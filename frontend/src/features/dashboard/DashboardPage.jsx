// Overview (KPIs/funnel) and Reports (forecast) tabs.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DollarSign, Flame, Kanban, Percent, History } from 'lucide-react'
import { api } from '../../api/client.js'
import { StatCard, Tabs, Loader, EmptyState } from '../../components/ui.jsx'
import { formatCurrency, formatDateTime, cn } from '../../lib/utils.js'
import { usePipelineStages } from '../../hooks.js'

// The default staleTime (see lib/queryClient.js) is 30s, which is right for
// most lists but wrong here: these numbers are a *summary of everything
// else* (leads, deals...), and creating a lead elsewhere has no way to know
// it should invalidate a totally separate ['dashboard'] query. staleTime: 0
// means "always treat this as stale," so it refetches every time you land
// on the page — the simple, honest fix for a summary view.
function useDashboardOverview() {
  return useQuery({
    queryKey: ['dashboard', 'overview'],
    queryFn: async () => (await api.get('/dashboard/overview')).data.data,
    staleTime: 0,
  })
}

function useDashboardReports() {
  return useQuery({
    queryKey: ['dashboard', 'reports'],
    queryFn: async () => (await api.get('/dashboard/reports')).data.data,
    staleTime: 0,
  })
}

/**
 * A horizontal bar list — e.g. "12 leads are 'new', 4 are 'qualified'…".
 * `rows` is [{ label, value, formattedValue }]; bar width is each row's
 * value relative to the largest value in the list.
 */
function BreakdownBars({ rows, emptyLabel }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-muted dark:text-muted-dark">{emptyLabel}</p>
  }
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="capitalize">{row.label}</span>
            <span className="font-medium">{row.formattedValue ?? row.value}</span>
          </div>
          <div className="h-2 rounded-full bg-black/[0.04] dark:bg-white/[0.06]">
            <div className="h-2 rounded-full bg-primary" style={{ width: `${(row.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function OverviewTab() {
  const { data, isLoading } = useDashboardOverview()
  const { labelFor, positionOf } = usePipelineStages()

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader className="h-6 w-6" />
      </div>
    )
  }

  const leadsByStatus = data?.leadsByStatus ?? {}
  const totalLeads = Object.values(leadsByStatus).reduce((sum, n) => sum + n, 0)
  // A funnel reads top to bottom in pipeline order, not aggregation order.
  const dealsByStage = [...(data?.dealsByStage ?? [])].sort((a, b) => positionOf(a.stageKey) - positionOf(b.stageKey))
  const totalDeals = dealsByStage.reduce((sum, s) => sum + s.count, 0)
  const recentActivity = data?.recentActivity ?? []


  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={DollarSign} label="Open pipeline value" value={formatCurrency(data?.openPipelineValue ?? 0)} tone="primary" />
        <StatCard icon={Flame} label="Total leads" value={totalLeads} tone="accent" />
        <StatCard icon={Kanban} label="Total deals" value={totalDeals} tone="success" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-5 dark:border-border-dark dark:bg-card-dark">
          <h2 className="mb-4 font-serif text-lg font-semibold">Leads by status</h2>
          <BreakdownBars
            rows={Object.entries(leadsByStatus).map(([label, value]) => ({ label, value }))}
            emptyLabel="No leads yet — create one to see this fill in."
          />
        </div>

        <div className="rounded-lg border border-border bg-card p-5 dark:border-border-dark dark:bg-card-dark">
          <h2 className="mb-4 font-serif text-lg font-semibold">Deals by stage</h2>
          <BreakdownBars
            rows={dealsByStage.map((s) => ({
              label: labelFor(s.stageKey),
              value: s.count,
              formattedValue: `${s.count} · ${formatCurrency(s.value)}`,
            }))}
            emptyLabel="No deals yet — convert a lead to start the pipeline."
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-5 dark:border-border-dark dark:bg-card-dark">
        <h2 className="mb-4 font-serif text-lg font-semibold">Recent activity</h2>
        {recentActivity.length === 0 ? (
          <EmptyState title="Nothing has happened yet" description="Activity across your org will show up here." />
        ) : (
          <ul className="flex flex-col gap-3">
            {recentActivity.map((entry) => (
              <li key={entry._id} className="flex items-start gap-3 text-sm">
                <History size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-muted dark:text-muted-dark" />
                <div>
                  <p>{entry.message}</p>
                  <p className="text-xs text-muted dark:text-muted-dark">
                    {entry.userId?.name ?? 'Someone'} · {formatDateTime(entry.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function ReportsTab() {
  const { data, isLoading } = useDashboardReports()

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader className="h-6 w-6" />
      </div>
    )
  }

  // The API returns one row per (year, month, won|lost) combination — group
  // them into one row per month so they can be drawn as a single bar pair.
  const monthKey = (row) => `${row._id.year}-${String(row._id.month).padStart(2, '0')}`
  const monthLabel = (row) => new Date(row._id.year, row._id.month - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })

  const byMonth = new Map()
  for (const row of data?.wonLostByMonth ?? []) {
    const key = monthKey(row)
    const entry = byMonth.get(key) ?? { label: monthLabel(row), won: 0, lost: 0 }
    entry[row._id.status] = row.value
    byMonth.set(key, entry)
  }
  const months = [...byMonth.values()]
  const maxValue = Math.max(1, ...months.flatMap((m) => [m.won, m.lost]))

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={Percent}
          label="Win rate"
          value={data?.winRate == null ? '—' : `${Math.round(data.winRate * 100)}%`}
          tone="success"
        />
        <StatCard icon={Kanban} label="Deals won" value={data?.won ?? 0} tone="success" />
        <StatCard icon={Kanban} label="Deals lost" value={data?.lost ?? 0} tone="danger" />
      </div>

      <div className="rounded-lg border border-border bg-card p-5 dark:border-border-dark dark:bg-card-dark">
        <h2 className="mb-4 font-serif text-lg font-semibold">Won vs. lost, by month</h2>
        {months.length === 0 ? (
          <EmptyState title="No closed deals yet" description="Win or lose a deal and this chart fills in." />
        ) : (
          <div className="flex items-end gap-4" style={{ height: 160 }}>
            {months.map((m) => (
              <div key={m.label} className="flex flex-1 flex-col items-center gap-2">
                <div className="flex h-32 items-end gap-1">
                  <div
                    className={cn('w-3 rounded-t', m.won === 0 ? 'bg-black/[0.06] dark:bg-white/[0.08]' : 'bg-success')}
                    style={{ height: `${Math.max(4, (m.won / maxValue) * 100)}%` }}
                    title={`Won: ${formatCurrency(m.won)}`}
                  />
                  <div
                    className={cn('w-3 rounded-t', m.lost === 0 ? 'bg-black/[0.06] dark:bg-white/[0.08]' : 'bg-danger')}
                    style={{ height: `${Math.max(4, (m.lost / maxValue) * 100)}%` }}
                    title={`Lost: ${formatCurrency(m.lost)}`}
                  />
                </div>
                <span className="text-xs text-muted dark:text-muted-dark">{m.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const [tab, setTab] = useState('overview')

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-serif text-xl font-semibold">Dashboard</h1>
      <Tabs
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'reports', label: 'Reports' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'overview' ? <OverviewTab /> : <ReportsTab />}
    </div>
  )
}
