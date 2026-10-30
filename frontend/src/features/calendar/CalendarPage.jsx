// Month/week grid over Activity resources of type=event.
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCrudQuery, useDisclosure } from '../../hooks.js'
import { Modal, ConfirmDialog } from '../../components/Modal.jsx'
import { FormField, inputClasses } from '../../components/FormField.jsx'
import { Button } from '../../components/ui.jsx'
import { cn } from '../../lib/utils.js'
import { useSession } from '../../context/SessionContext.jsx'
import { canModifyRecord } from '../../lib/constants.js'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Local YYYY-MM-DD — deliberately not toISOString(), which converts to UTC
// and can shift a date across midnight for anyone not in UTC.
const dateKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/** The 42 (6×7) day cells a month grid needs, starting on the Sunday on/before the 1st. */
function buildMonthGrid(monthDate) {
  const firstOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
  const gridStart = new Date(firstOfMonth)
  gridStart.setDate(1 - firstOfMonth.getDay())
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    return d
  })
}

const eventSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  description: z.string().trim().optional(),
  startAt: z.string().min(1, 'Start time is required'),
  endAt: z.string().optional(),
})

// <input type="datetime-local"> needs "YYYY-MM-DDTHH:mm" in local time.
const toDateTimeLocal = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function CalendarPage() {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [editing, setEditing] = useState(null)
  const confirmDelete = useDisclosure()
  const { user, can } = useSession()
  // Events belong to their assignee: members can only change their own.
  const readOnly = Boolean(editing?._id) && !canModifyRecord(user, editing, 'assigneeId')

  const days = useMemo(() => buildMonthGrid(month), [month])
  const rangeStart = days[0]
  const rangeEnd = days[days.length - 1]

  const activities = useCrudQuery('activities')
  const { data, isLoading } = activities.useList({
    type: 'event',
    limit: 100,
    dateFrom: rangeStart.toISOString(),
    dateTo: rangeEnd.toISOString(),
  })
  const createEvent = activities.useCreate()
  const updateEvent = activities.useUpdate()
  const removeEvent = activities.useRemove()

  const eventsByDay = useMemo(() => {
    const map = new Map()
    for (const event of data?.data ?? []) {
      const key = dateKey(new Date(event.startAt))
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(event)
    }
    return map
  }, [data])

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(eventSchema) })

  const openCreate = (day) => {
    const defaultStart = new Date(day)
    defaultStart.setHours(9, 0, 0, 0)
    reset({ title: '', description: '', startAt: toDateTimeLocal(defaultStart.toISOString()), endAt: '' })
    setEditing({})
  }
  const openEdit = (event) => {
    reset({ ...event, startAt: toDateTimeLocal(event.startAt), endAt: toDateTimeLocal(event.endAt) })
    setEditing(event)
  }
  const close = () => setEditing(null)

  const onSubmit = async (values) => {
    const payload = {
      type: 'event',
      title: values.title,
      description: values.description,
      startAt: new Date(values.startAt).toISOString(),
      endAt: values.endAt ? new Date(values.endAt).toISOString() : undefined,
    }
    if (editing?._id) await updateEvent.mutateAsync({ id: editing._id, ...payload })
    else await createEvent.mutateAsync(payload)
    close()
  }

  const today = dateKey(new Date())

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="font-serif text-xl font-semibold">Calendar</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            aria-label="Previous month"
          >
            <ChevronLeft size={16} strokeWidth={1.75} />
          </Button>
          <span className="min-w-[140px] text-center text-sm font-medium">
            {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </span>
          <Button
            variant="secondary"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            aria-label="Next month"
          >
            <ChevronRight size={16} strokeWidth={1.75} />
          </Button>
        </div>
      </div>

      <div className={cn('rounded-lg border border-border dark:border-border-dark', isLoading && 'opacity-50')}>
        <div className="grid grid-cols-7 border-b border-border dark:border-border-dark">
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className="p-2 text-center text-xs font-medium uppercase tracking-wide text-muted dark:text-muted-dark"
            >
              {label}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day, i) => {
            const key = dateKey(day)
            const dayEvents = eventsByDay.get(key) ?? []
            const isCurrentMonth = day.getMonth() === month.getMonth()
            return (
              <button
                key={key}
                type="button"
                onClick={() => openCreate(day)}
                className={cn(
                  'flex min-h-24 flex-col items-start gap-1 border-b border-r border-border p-2 text-left align-top dark:border-border-dark',
                  i % 7 === 6 && 'border-r-0',
                  !isCurrentMonth && 'bg-black/[0.015] dark:bg-white/[0.02]',
                  'hover:bg-black/[0.02] dark:hover:bg-white/[0.03]',
                )}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full text-xs',
                    key === today
                      ? 'bg-primary font-semibold text-white'
                      : isCurrentMonth
                        ? 'text-text dark:text-text-dark'
                        : 'text-muted dark:text-muted-dark',
                  )}
                >
                  {day.getDate()}
                </span>
                <div className="flex w-full flex-col gap-0.5">
                  {dayEvents.slice(0, 3).map((event) => (
                    <span
                      key={event._id}
                      onClick={(e) => {
                        e.stopPropagation()
                        openEdit(event)
                      }}
                      className="truncate rounded bg-primary-50 px-1.5 py-0.5 text-xs text-primary dark:bg-primary/10 dark:text-primary-dark"
                    >
                      {event.title}
                    </span>
                  ))}
                  {dayEvents.length > 3 && (
                    <span className="text-xs text-muted dark:text-muted-dark">+{dayEvents.length - 3} more</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <Modal
        isOpen={Boolean(editing)}
        onClose={close}
        title={editing?._id ? 'Edit event' : 'New event'}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            {editing?._id && can('crm', 'delete') && (
              <Button variant="danger" onClick={confirmDelete.open}>
                Delete
              </Button>
            )}
            <Button
              type="submit"
              form="event-form"
              disabled={isSubmitting || readOnly}
              title={readOnly ? 'Only the assignee can edit this event' : undefined}
            >
              {editing?._id ? 'Save' : 'Create'}
            </Button>
          </>
        }
      >
        <form id="event-form" onSubmit={handleSubmit(onSubmit)}>
          <FormField label="Title" error={errors.title}>
            <input className={inputClasses(errors.title)} {...register('title')} />
          </FormField>
          <FormField label="Starts" error={errors.startAt}>
            <input type="datetime-local" className={inputClasses(errors.startAt)} {...register('startAt')} />
          </FormField>
          <FormField label="Ends" hint="Optional">
            <input type="datetime-local" className={inputClasses(false)} {...register('endAt')} />
          </FormField>
          <FormField label="Description">
            <textarea rows={3} className={inputClasses(false)} {...register('description')} />
          </FormField>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={confirmDelete.isOpen}
        onClose={confirmDelete.close}
        onConfirm={() => {
          removeEvent.mutate(editing._id)
          close()
        }}
        title="Delete this event?"
        description={`This will permanently remove "${editing?.title}".`}
        confirmLabel="Delete"
      />
    </div>
  )
}
