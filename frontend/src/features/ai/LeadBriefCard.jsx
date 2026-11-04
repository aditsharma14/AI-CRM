// The AI lead brief on a lead's page: generate it, read it with citations that scroll to the history entry they rest
// on, copy the draft email (never sent from here), regenerate. Hidden while AI is off (GET /config: aiEnabled).
import { useMutation } from '@tanstack/react-query'
import { Copy, RefreshCw, Sparkles } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api/client.js'
import { Button } from '../../components/ui.jsx'
import { useAppConfig } from '../../hooks.js'
import { apiErrorMessage, cn, formatDate } from '../../lib/utils.js'

const RETRYABLE = new Set(['AI_UNAVAILABLE', 'AI_BAD_OUTPUT'])
const HIGHLIGHT = ['ring-2', 'ring-accent', 'bg-accent-50', 'dark:bg-accent/10']

/** What went wrong, in words, and whether trying again could help. AI errors carry their own safe message. */
function describe(error) {
  const envelope = error?.response?.data?.error
  if (envelope?.code?.startsWith('AI_')) return { text: envelope.message, retry: RETRYABLE.has(envelope.code) }
  return { text: apiErrorMessage(error), retry: !error?.response || error.response.status >= 500 }
}

/** Scrolls to a history entry and highlights it for two seconds. */
function showSource(id) {
  const el = document.getElementById(`history-${id}`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.focus({ preventScroll: true })
  el.classList.add(...HIGHLIGHT)
  setTimeout(() => el.classList.remove(...HIGHLIGHT), 2000)
}

export function LeadBriefCard({ leadId, history = [] }) {
  const { aiEnabled } = useAppConfig()
  const [copied, setCopied] = useState(false)
  const [lastRefresh, setLastRefresh] = useState(false)
  const generate = useMutation({
    mutationFn: async (refresh) =>
      (await api.post(`/ai/leads/${leadId}/brief`, refresh ? { refresh: true } : {})).data.data,
  })
  if (!aiEnabled) return null

  const run = (refresh) => {
    setLastRefresh(refresh)
    setCopied(false)
    generate.mutate(refresh)
  }
  const labelOf = (id) => {
    const item = history.find((h) => h.id === id)
    return item ? `${item.kind === 'note' ? 'Note' : item.title || item.kind} · ${formatDate(item.date)}` : 'Source'
  }
  const brief = generate.data

  const copyEmail = async () => {
    await navigator.clipboard.writeText(`Subject: ${brief.followUpEmail.subject}\n\n${brief.followUpEmail.body}`)
    setCopied(true)
  }

  return (
    <section
      aria-labelledby="brief-heading"
      className="self-start rounded-lg border border-border bg-surface p-4 shadow-soft dark:border-border-dark dark:bg-surface-dark"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="brief-heading" className="flex items-center gap-2 font-serif text-lg font-semibold">
          <Sparkles size={18} strokeWidth={1.75} className="text-accent dark:text-accent-dark" aria-hidden="true" />
          AI brief
        </h2>
        {brief && (
          <Button variant="secondary" onClick={() => run(true)} disabled={generate.isPending}>
            <RefreshCw size={14} aria-hidden="true" /> Regenerate
          </Button>
        )}
      </div>

      {generate.isPending ? (
        <div>
          <p role="status" className="mb-3 text-sm text-muted dark:text-muted-dark">
            Generating, this can take a few seconds
          </p>
          <div aria-hidden="true" className="space-y-2">
            {['w-full', 'w-11/12', 'w-4/5', 'w-2/3'].map((width) => (
              <div
                key={width}
                className={cn('h-4 rounded bg-border/60 motion-safe:animate-pulse dark:bg-border-dark/60', width)}
              />
            ))}
          </div>
        </div>
      ) : generate.isError ? (
        <ErrorWithRetry {...describe(generate.error)} onRetry={() => run(lastRefresh)} />
      ) : !brief ? (
        <div>
          <p className="mb-3 text-sm text-muted dark:text-muted-dark">
            A short summary, a next step and a draft follow-up email, written from this lead's history.
          </p>
          <Button onClick={() => run(false)}>
            <Sparkles size={14} aria-hidden="true" /> Generate brief
          </Button>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <div>
            <p>{brief.summary}</p>
            <Citations citations={brief.citations} labelOf={labelOf} />
          </div>

          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted dark:text-muted-dark">
              Next step
            </h3>
            <p>
              {brief.nextAction.action}{' '}
              <span className="text-muted dark:text-muted-dark">by {formatDate(brief.nextAction.dueDate)}</span>
            </p>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted dark:text-muted-dark">
                Follow-up email (draft)
              </h3>
              <Button variant="ghost" onClick={copyEmail} className="px-2 py-1 text-xs">
                <Copy size={13} aria-hidden="true" /> {copied ? 'Copied' : 'Copy email'}
              </Button>
            </div>
            <div className="rounded-md border border-border p-3 dark:border-border-dark">
              <p className="font-medium">{brief.followUpEmail.subject}</p>
              <p className="mt-2 whitespace-pre-line">{brief.followUpEmail.body}</p>
            </div>
          </div>

          <p className="text-xs text-muted dark:text-muted-dark">
            Generated by AI, check before sending. {brief.cached ? 'From cache' : 'Generated'}{' '}
            {formatDate(brief.generatedAt)} · {brief.model}
            {brief.truncated > 0 &&
              ` · ${brief.truncated} older ${brief.truncated === 1 ? 'item was' : 'items were'} left out`}
          </p>
        </div>
      )}
    </section>
  )
}

function Citations({ citations, labelOf }) {
  const ids = [...new Set(citations.flatMap((c) => c.sourceIds))]
  if (!ids.length) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted dark:text-muted-dark">Based on:</span>
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => showSource(id)}
          className="rounded-full border border-border px-2 py-0.5 hover:bg-black/[0.04] dark:border-border-dark dark:hover:bg-white/[0.06]"
        >
          {labelOf(id)}
        </button>
      ))}
    </div>
  )
}

function ErrorWithRetry({ text, retry, onRetry }) {
  return (
    <div role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
      <p>{text}</p>
      {retry && (
        <button type="button" onClick={onRetry} className="mt-1 font-medium underline underline-offset-2">
          Retry
        </button>
      )}
    </div>
  )
}
