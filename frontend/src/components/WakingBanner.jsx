// "Waking up the server…": shown while a request waits on a sleeping backend (see the cold-start notes in client.js).
import { useSyncExternalStore } from 'react'

import { isWaking, subscribeWaking } from '../api/client.js'

export function WakingBanner() {
  const waking = useSyncExternalStore(subscribeWaking, isWaking)
  if (!waking) return null
  return (
    <div
      role="status"
      className="fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-md bg-accent-50 px-4 py-2 text-sm text-accent shadow-soft dark:bg-accent/10 dark:text-accent-dark"
    >
      Waking up the server… this can take up to a minute.
    </div>
  )
}
