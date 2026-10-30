// Bell dropdown and full notifications list, mark-read.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { Bell, CheckCheck, Inbox } from 'lucide-react'
import { api } from '../../api/client.js'
import { formatDateTime, cn } from '../../lib/utils.js'
import { Loader } from '../../components/ui.jsx'

/**
 * Exported separately from the component so AppLayout can read
 * `data.meta.unreadCount` for the little red badge on the bell icon,
 * without duplicating this fetch call — React Query shares one cached
 * result between every component that asks for this same query key.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useNotifications() {
  return useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: async () => (await api.get('/notifications', { params: { limit: 10 } })).data,
    // No WebSockets yet (see the architecture's scalability roadmap) —
    // polling every 30s is the deliberate, simple stand-in for now.
    refetchInterval: 30_000,
  })
}

/** The bell icon + unread-count badge that sits in AppLayout's header. */
export function NotificationsBell({ buttonRef, onClick }) {
  const { data } = useNotifications()
  const unreadCount = data?.meta?.unreadCount ?? 0

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      className="relative rounded-md p-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
      aria-label="Notifications"
    >
      <Bell size={18} strokeWidth={1.75} />
      {unreadCount > 0 && (
        <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-medium text-white">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  )
}

/** The dropdown panel itself. AppLayout wraps this in <AnimatePresence> for the enter/exit animation. */
export default function NotificationsPanel({ onClose }) {
  const { data, isLoading } = useNotifications()
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['notifications'] })

  const markRead = useMutation({
    mutationFn: (id) => api.patch(`/notifications/${id}/read`),
    onSuccess: invalidate,
  })
  const markAllRead = useMutation({
    mutationFn: () => api.patch('/notifications/read-all'),
    onSuccess: invalidate,
  })

  const notifications = data?.data ?? []

  return (
    <motion.div
      initial={{ opacity: 0, y: -4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.98 }}
      transition={{ duration: 0.12 }}
      className="absolute right-0 top-full z-40 mt-2 w-80 rounded-lg border border-border bg-surface shadow-soft dark:border-border-dark dark:bg-surface-dark"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3 dark:border-border-dark">
        <p className="text-sm font-medium">Notifications</p>
        <button
          type="button"
          onClick={() => markAllRead.mutate()}
          className="flex items-center gap-1 text-xs text-muted hover:text-text dark:text-muted-dark dark:hover:text-text-dark"
        >
          <CheckCheck size={14} strokeWidth={1.75} />
          Mark all read
        </button>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader className="h-5 w-5" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Inbox size={24} strokeWidth={1.75} className="text-muted dark:text-muted-dark" />
            <p className="text-sm text-muted dark:text-muted-dark">You're all caught up.</p>
          </div>
        ) : (
          notifications.map((note) => (
            <button
              key={note._id}
              onClick={() => {
                if (!note.read) markRead.mutate(note._id)
                onClose()
              }}
              className={cn(
                'flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left last:border-0 hover:bg-black/[0.03] dark:border-border-dark dark:hover:bg-white/[0.04]',
                !note.read && 'bg-primary-50 dark:bg-primary/10',
              )}
            >
              <div className="flex items-start gap-2">
                {!note.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                <p
                  className={cn(
                    'text-sm',
                    note.read ? 'text-muted dark:text-muted-dark' : 'text-text dark:text-text-dark',
                  )}
                >
                  {note.message}
                </p>
              </div>
              <p className="pl-3.5 text-xs text-muted dark:text-muted-dark">{formatDateTime(note.createdAt)}</p>
            </button>
          ))
        )}
      </div>
    </motion.div>
  )
}
