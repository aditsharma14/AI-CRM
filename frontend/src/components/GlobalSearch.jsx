// Debounced omnibox querying cross-entity global search.
// This component also IS the Ctrl+K command palette — AppLayout mounts one
// instance and opens it either from the header's search button or the
// keyboard shortcut, so there's exactly one search experience, not two.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Search,
  Users,
  Building2,
  Flame,
  Kanban,
  ArrowRight,
  LayoutDashboard,
  Calendar,
  ListChecks,
  Settings,
} from 'lucide-react'
import { api } from '../api/client.js'
import { useDebounce } from '../hooks.js'

const QUICK_LINKS = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
  { label: 'Leads', to: '/leads', icon: Flame },
  { label: 'Contacts', to: '/contacts', icon: Users },
  { label: 'Companies', to: '/companies', icon: Building2 },
  { label: 'Pipeline', to: '/deals', icon: Kanban },
  { label: 'Tasks', to: '/tasks', icon: ListChecks },
  { label: 'Calendar', to: '/calendar', icon: Calendar },
  { label: 'Settings', to: '/settings', icon: Settings },
]

const RESULT_GROUPS = [
  { key: 'leads', label: 'Leads', icon: Flame, to: '/leads' },
  { key: 'contacts', label: 'Contacts', icon: Users, to: '/contacts' },
  { key: 'companies', label: 'Companies', icon: Building2, to: '/companies' },
  { key: 'deals', label: 'Deals', icon: Kanban, to: '/deals' },
]

export default function GlobalSearch({ isOpen, onClose }) {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, 250)
  const inputRef = useRef(null)
  const navigate = useNavigate()
  const hasQuery = query.trim().length > 0

  // Clears the query on the way out, so the palette is always blank the
  // next time it opens. This runs from an event handler (a key press, a
  // click), not an effect — React's own docs recommend against calling
  // setState directly inside useEffect when a handler works just as well.
  const handleClose = () => {
    setQuery('')
    onClose()
  }

  // Refocusing the input IS a legitimate effect (imperatively touching a
  // DOM node rather than updating state), so it stays a useEffect.
  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 0)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // The search endpoint itself was built and tested back in Phase 9's
  // backend work (GET /api/v1/search) — this just calls it.
  const { data, isFetching } = useQuery({
    queryKey: ['global-search', debouncedQuery],
    queryFn: async () => (await api.get('/search', { params: { q: debouncedQuery } })).data.data,
    enabled: isOpen && hasQuery,
  })

  const goTo = (path) => {
    navigate(path)
    handleClose()
  }

  const hasResults = RESULT_GROUPS.some((group) => (data?.[group.key]?.length ?? 0) > 0)

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24"
          onClick={handleClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="w-full max-w-lg overflow-hidden rounded-lg border border-border bg-surface shadow-soft dark:border-border-dark dark:bg-surface-dark"
          >
            <div className="flex items-center gap-2 border-b border-border px-4 py-3 dark:border-border-dark">
              <Search size={18} strokeWidth={1.75} className="text-muted dark:text-muted-dark" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search leads, contacts, companies, deals…"
                className="w-full bg-transparent text-base outline-none placeholder:text-muted dark:placeholder:text-muted-dark"
              />
              <kbd className="rounded border border-border px-1.5 py-0.5 text-xs text-muted dark:border-border-dark dark:text-muted-dark">
                Esc
              </kbd>
            </div>

            <div className="max-h-96 overflow-y-auto p-2">
              {!hasQuery &&
                QUICK_LINKS.map((link) => (
                  <button
                    key={link.to}
                    onClick={() => goTo(link.to)}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                  >
                    <link.icon size={18} strokeWidth={1.75} className="text-muted dark:text-muted-dark" />
                    {link.label}
                  </button>
                ))}

              {hasQuery && isFetching && (
                <p className="px-3 py-6 text-center text-sm text-muted dark:text-muted-dark">Searching…</p>
              )}

              {hasQuery && !isFetching && !hasResults && (
                <p className="px-3 py-6 text-center text-sm text-muted dark:text-muted-dark">
                  No results for &quot;{query}&quot;
                </p>
              )}

              {hasQuery &&
                !isFetching &&
                RESULT_GROUPS.map((group) => {
                  const items = data?.[group.key] ?? []
                  if (items.length === 0) return null
                  return (
                    <div key={group.key} className="mb-2">
                      <p className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted dark:text-muted-dark">
                        {group.label}
                      </p>
                      {items.map((item) => (
                        <button
                          key={item._id}
                          onClick={() => goTo(group.to)}
                          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                        >
                          <group.icon size={18} strokeWidth={1.75} className="text-muted dark:text-muted-dark" />
                          <span className="flex-1 truncate">{item.name ?? item.title}</span>
                          <ArrowRight size={14} strokeWidth={1.75} className="text-muted dark:text-muted-dark" />
                        </button>
                      ))}
                    </div>
                  )
                })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
