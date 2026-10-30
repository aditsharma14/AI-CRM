// Authenticated shell: sidebar, top nav, command palette, notifications, outlet.
import { AnimatePresence, motion } from 'framer-motion'
import {
  Building2,
  Calendar,
  ChevronsUpDown,
  Command,
  Flame,
  Kanban,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Sun,
  Users,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'

import GlobalSearch from '../components/GlobalSearch.jsx'
import { useSession } from '../context/SessionContext.jsx'
import NotificationsPanel, { NotificationsBell } from '../features/notifications/NotificationsPanel.jsx'
import { useClickOutside } from '../hooks.js'
import { cn, initials } from '../lib/utils.js'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true, icon: LayoutDashboard },
  { to: '/leads', label: 'Leads', icon: Flame },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/companies', label: 'Companies', icon: Building2 },
  { to: '/deals', label: 'Pipeline', icon: Kanban },
  { to: '/tasks', label: 'Tasks', icon: ListChecks },
  { to: '/calendar', label: 'Calendar', icon: Calendar },
]

// Settings isn't in NAV_ITEMS (it's rendered as its own link below the main
// list, visible to every role), but the breadcrumb still needs to know its
// label — this is the one extra entry that covers it.
const BREADCRUMB_ITEMS = [...NAV_ITEMS, { to: '/settings', label: 'Settings', icon: Settings }]

/**
 * A small "is dark mode on" toggle. It reads/writes the same localStorage
 * key that index.html's inline script reads on first page load, so the
 * choice survives a refresh.
 */
function ThemeToggle() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    localStorage.setItem('theme', isDark ? 'dark' : 'light')
  }, [isDark])

  return (
    <button
      type="button"
      onClick={() => setIsDark((v) => !v)}
      className="rounded-md p-2 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
      aria-label="Toggle color theme"
    >
      {isDark ? <Sun size={18} strokeWidth={1.75} /> : <Moon size={18} strokeWidth={1.75} />}
    </button>
  )
}

export default function AppLayout() {
  const { user, isAuthenticated, logout } = useSession()
  const location = useLocation()

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)

  // Only one header dropdown can be open at a time — 'notifications',
  // 'profile', or null. One variable instead of two booleans makes that
  // "only one at a time" rule impossible to violate by accident.
  const [openMenu, setOpenMenu] = useState(null)
  const isNotificationsOpen = openMenu === 'notifications'
  const isProfileMenuOpen = openMenu === 'profile'
  const toggleNotifications = () => setOpenMenu((m) => (m === 'notifications' ? null : 'notifications'))
  const toggleProfileMenu = () => setOpenMenu((m) => (m === 'profile' ? null : 'profile'))

  const notificationsRef = useRef(null)
  const profileMenuRef = useRef(null)
  useClickOutside(notificationsRef, () => setOpenMenu((m) => (m === 'notifications' ? null : m)))
  useClickOutside(profileMenuRef, () => setOpenMenu((m) => (m === 'profile' ? null : m)))

  // Global Ctrl+K / Cmd+K shortcut to open the command palette from anywhere.
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const currentPage = BREADCRUMB_ITEMS.find((item) =>
    item.end ? location.pathname === item.to : location.pathname.startsWith(item.to),
  )

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          'flex flex-col border-r border-border bg-surface transition-[width] duration-200 dark:border-border-dark dark:bg-surface-dark',
          isSidebarCollapsed ? 'w-16' : 'w-64',
        )}
      >
        <div className={cn('flex items-center gap-2 px-4 py-4', isSidebarCollapsed && 'justify-center px-0')}>
          {!isSidebarCollapsed && (
            <span className="font-serif text-lg font-semibold text-primary dark:text-primary-dark">Clarion</span>
          )}
        </div>

        {/* Organization display. There's one org per account today (see the
            architecture spec), so this is an honest label, not a fake
            multi-workspace switcher — it links straight to org settings. */}
        {!isSidebarCollapsed && user?.org && (
          <NavLink
            to="/settings"
            className="mx-3 mb-2 flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-black/[0.03] dark:border-border-dark dark:hover:bg-white/[0.04]"
          >
            <span className="truncate font-medium">{user.org.name}</span>
            <ChevronsUpDown size={14} strokeWidth={1.75} className="text-muted dark:text-muted-dark" />
          </NavLink>
        )}

        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={isSidebarCollapsed ? item.label : undefined}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm',
                  isSidebarCollapsed && 'justify-center px-0',
                  isActive
                    ? 'bg-primary-50 font-medium text-primary dark:bg-primary/10 dark:text-primary-dark'
                    : 'text-secondary hover:bg-black/[0.04] dark:text-secondary-dark dark:hover:bg-white/[0.06]',
                )
              }
            >
              <item.icon size={18} strokeWidth={1.75} />
              {!isSidebarCollapsed && item.label}
            </NavLink>
          ))}

          {/* Visible to every member — Settings itself has a Profile tab
              everyone needs; the tabs gate management actions by role. */}
          <NavLink
            to="/settings"
            title={isSidebarCollapsed ? 'Settings' : undefined}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm',
                isSidebarCollapsed && 'justify-center px-0',
                isActive
                  ? 'bg-primary-50 font-medium text-primary dark:bg-primary/10 dark:text-primary-dark'
                  : 'text-secondary hover:bg-black/[0.04] dark:text-secondary-dark dark:hover:bg-white/[0.06]',
              )
            }
          >
            <Settings size={18} strokeWidth={1.75} />
            {!isSidebarCollapsed && 'Settings'}
          </NavLink>
        </nav>

        <button
          type="button"
          onClick={() => setIsSidebarCollapsed((v) => !v)}
          className="m-3 flex items-center justify-center rounded-md p-2 text-muted hover:bg-black/[0.04] dark:text-muted-dark dark:hover:bg-white/[0.06]"
          aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isSidebarCollapsed ? (
            <PanelLeftOpen size={18} strokeWidth={1.75} />
          ) : (
            <PanelLeftClose size={18} strokeWidth={1.75} />
          )}
        </button>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-surface/80 px-6 py-3 backdrop-blur dark:border-border-dark dark:bg-surface-dark/80">
          <p className="text-sm text-muted dark:text-muted-dark">
            Clarion <span className="mx-1.5">/</span>
            <span className="font-medium text-text dark:text-text-dark">{currentPage?.label ?? 'Dashboard'}</span>
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsSearchOpen(true)}
              className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-black/[0.03] dark:border-border-dark dark:text-muted-dark dark:hover:bg-white/[0.04]"
            >
              <Search size={16} strokeWidth={1.75} />
              Search
              <kbd className="ml-2 flex items-center gap-0.5 rounded border border-border px-1 text-xs dark:border-border-dark">
                <Command size={11} strokeWidth={1.75} />K
              </kbd>
            </button>

            <ThemeToggle />

            {isAuthenticated ? (
              <>
                <div className="relative" ref={notificationsRef}>
                  <NotificationsBell onClick={toggleNotifications} />
                  <AnimatePresence>
                    {isNotificationsOpen && <NotificationsPanel onClose={() => setOpenMenu(null)} />}
                  </AnimatePresence>
                </div>

                <div className="relative" ref={profileMenuRef}>
                  <button
                    type="button"
                    onClick={toggleProfileMenu}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white"
                  >
                    {initials(user?.name)}
                  </button>
                  <AnimatePresence>
                    {isProfileMenuOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -4, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4, scale: 0.98 }}
                        transition={{ duration: 0.12 }}
                        className="absolute right-0 top-full z-40 mt-2 w-56 rounded-lg border border-border bg-surface p-1 shadow-soft dark:border-border-dark dark:bg-surface-dark"
                      >
                        <div className="px-3 py-2">
                          <p className="truncate text-sm font-medium">{user?.name}</p>
                          <p className="truncate text-xs text-muted dark:text-muted-dark">{user?.email}</p>
                        </div>
                        <div className="my-1 border-t border-border dark:border-border-dark" />
                        <button
                          type="button"
                          onClick={logout}
                          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-danger hover:bg-danger/10"
                        >
                          <LogOut size={16} strokeWidth={1.75} />
                          Log out
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  className="rounded-md px-3 py-1.5 text-sm text-secondary hover:bg-black/[0.04] dark:text-secondary-dark dark:hover:bg-white/[0.06]"
                >
                  Log in
                </Link>
                <Link
                  to="/register"
                  className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
                >
                  Sign up
                </Link>
              </>
            )}
          </div>
        </header>

        {/* Pages are viewable without a session, but every real read/write
            needs one — this is the one honest place that says so. */}
        {!isAuthenticated && (
          <div className="flex items-center justify-center gap-3 border-b border-border bg-accent-50 px-4 py-2 text-sm text-accent dark:border-border-dark dark:bg-accent/10 dark:text-accent-dark">
            <span>You're browsing Clarion without an account — data won't load or save until you log in.</span>
            <Link to="/login" className="font-medium underline underline-offset-2">
              Log in
            </Link>
            <Link to="/register" className="font-medium underline underline-offset-2">
              Sign up
            </Link>
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>

      <GlobalSearch isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
    </div>
  )
}
