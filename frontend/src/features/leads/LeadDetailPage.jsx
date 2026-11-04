// One lead: its details and its history (activities and notes, newest first). Each history entry has an id
// (history-<id>) that other parts of the page can scroll to.
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CalendarClock, MessageSquareText, Phone, Users } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'

import { api } from '../../api/client.js'
import { ErrorAlert } from '../../components/ErrorAlert.jsx'
import { Badge, EmptyState, PageSkeleton } from '../../components/ui.jsx'
import { formatDate } from '../../lib/utils.js'
import { historyOf } from './history.js'

const STATUS_VARIANT = { qualified: 'success', converted: 'success', unqualified: 'danger', contacted: 'warning' }
const ICON = { call: Phone, meeting: Users, task: CalendarClock, event: CalendarClock, note: MessageSquareText }

const list = async (path, params) => (await api.get(path, { params })).data.data

export default function LeadDetailPage() {
  const { id } = useParams()
  const lead = useQuery({
    queryKey: ['leads', 'detail', id],
    queryFn: async () => (await api.get(`/leads/${id}`)).data.data,
  })
  const scope = { entityType: 'lead', entityId: id }
  const activities = useQuery({
    queryKey: ['activities', 'list', 'lead', id],
    queryFn: () => list('/activities', { ...scope, limit: 100 }),
  })
  const notes = useQuery({
    queryKey: ['notes', 'list', 'lead', id],
    queryFn: () => list('/notes', { ...scope, limit: 100 }),
  })

  if (lead.isLoading) return <PageSkeleton />
  if (lead.isError) {
    const missing = lead.error?.response?.status === 404
    return (
      <div>
        <BackLink />
        {missing ? (
          <EmptyState
            title="Lead not found"
            description="It may have been deleted, or it belongs to another workspace."
          />
        ) : (
          <ErrorAlert error={lead.error} onRetry={() => lead.refetch()} />
        )}
      </div>
    )
  }

  const l = lead.data
  const history = historyOf(activities.data, notes.data)
  return (
    <div>
      <BackLink />
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-xl font-semibold">{l.name}</h1>
          <Badge variant={STATUS_VARIANT[l.status]}>{l.status}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted dark:text-muted-dark">
          {[l.companyId?.name, l.email, l.phone, l.source && `from ${l.source}`, `score ${l.score ?? 0}`]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section aria-labelledby="history-heading">
          <h2 id="history-heading" className="mb-3 font-serif text-lg font-semibold">
            History
          </h2>
          <ErrorAlert error={activities.error ?? notes.error} />
          {history.length === 0 && !activities.isLoading && !notes.isLoading ? (
            <EmptyState
              title="No history yet"
              description="Calls, meetings, tasks and notes for this lead show here."
            />
          ) : (
            <ol className="space-y-2">
              {history.map((item) => {
                const Icon = ICON[item.kind] ?? CalendarClock
                return (
                  <li
                    key={item.id}
                    id={`history-${item.id}`}
                    tabIndex={-1}
                    className="scroll-mt-24 rounded-md border border-border p-3 transition-colors duration-700 dark:border-border-dark"
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <Icon size={15} strokeWidth={1.75} aria-hidden="true" className="text-muted" />
                      <span className="font-medium">{item.title}</span>
                      {item.status === 'open' && <Badge variant="warning">open</Badge>}
                      <span className="ml-auto text-xs text-muted dark:text-muted-dark">{formatDate(item.date)}</span>
                    </div>
                    {item.text && <p className="mt-1 whitespace-pre-line text-sm">{item.text}</p>}
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  )
}

function BackLink() {
  return (
    <Link
      to="/leads"
      className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:underline dark:text-muted-dark"
    >
      <ArrowLeft size={14} aria-hidden="true" /> Leads
    </Link>
  )
}
