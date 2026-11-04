// The demo's AI lead brief: the same bundle rules as backend/src/services/aiBriefService.js and the same deterministic
// output as the AI service's FakeProvider (AI/app/providers/fake.py), so the Pages demo shows the feature with no model.

export const HISTORY_LIMIT = 20
export const ITEM_CHARS = 1000
export const BUNDLE_CHARS = 12_000
const DAY_MS = 24 * 60 * 60 * 1000

const isoDay = (date) => new Date(date).toISOString().slice(0, 10)
const addDays = (day, n) => isoDay(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS)

/** The lead's history, newest first, within 20 items and 12,000 characters (the oldest are left out). */
export function buildBundle(db, lead, today) {
  const activities = db.activities
    .filter((a) => a.linkedTo?.entityType === 'lead' && a.linkedTo.entityId === lead._id)
    .map((a) => ({
      id: a._id,
      kind: 'activity',
      type: a.type,
      title: a.title?.slice(0, 200),
      text: (a.description ?? '').slice(0, ITEM_CHARS),
      date: a.dueDate ?? a.startAt ?? a.createdAt,
      status: a.status,
      updatedAt: a.updatedAt,
    }))
  const notes = db.notes
    .filter((n) => n.entityType === 'lead' && n.entityId === lead._id)
    .map((n) => ({
      id: n._id,
      kind: 'note',
      text: n.body.slice(0, ITEM_CHARS),
      date: n.createdAt,
      updatedAt: n.updatedAt,
    }))
  const items = [...activities, ...notes].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))

  const sent = []
  let chars = 0
  for (const item of items) {
    const size = (item.title ?? '').length + item.text.length
    if (sent.length === HISTORY_LIMIT || chars + size > BUNDLE_CHARS) break
    sent.push(item)
    chars += size
  }
  const company = db.companies.find((c) => c._id === lead.companyId)
  return {
    today,
    lead: { name: lead.name, company: company?.name ?? null, status: lead.status, source: lead.source ?? null },
    history: sent,
    truncated: items.length - sent.length,
  }
}

const label = (item) => item.title || (item.text ? item.text.slice(0, 80) : item.kind)

/** FakeProvider.brief, line for line. */
export function fakeBrief({ today, lead, history: unsorted }) {
  const history = [...unsorted].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
  const openTasks = history
    .filter((h) => h.type === 'task' && h.status === 'open')
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
  const who = lead.company ? `${lead.name} at ${lead.company}` : lead.name
  let summary = `${who} is a ${lead.status} lead from ${lead.source || 'an unknown source'}.`
  const citations = []
  if (history.length) {
    const latest = history[0]
    summary += ` There are ${history.length} recorded updates; the latest, on ${isoDay(latest.date)}, is: ${label(latest)}.`
    citations.push({ claim: summary.slice(0, 300), sourceIds: [latest.id] })
  } else {
    summary += ' There is no recorded activity yet.'
  }

  let due = addDays(today, 2)
  let action
  if (openTasks.length) {
    const task = openTasks[0]
    action = `Complete the open task: ${label(task)}`.slice(0, 200)
    const taskDay = isoDay(task.date)
    const latest = addDays(today, 60)
    due = taskDay < today ? today : taskDay > latest ? latest : taskDay
    citations.push({ claim: action, sourceIds: [task.id] })
  } else {
    action = `Call ${lead.name} to agree on next steps`.slice(0, 200)
  }

  const firstName = lead.name.split(' ')[0]
  return {
    summary: summary.slice(0, 800),
    nextAction: { action, dueDate: due },
    followUpEmail: {
      subject: `Following up, ${firstName}`.slice(0, 120),
      body:
        `Hi ${firstName},\n\nThank you for your time so far. I wanted to follow up on where things stand ` +
        'and see whether a short call this week would help.\n\nBest regards',
    },
    citations,
  }
}

/** Cache key: the lead, its last change and each sent item's (as the API's, minus what never varies here). */
export const briefKey = (lead, bundle) =>
  JSON.stringify([lead._id, lead.updatedAt, bundle.history.map((h) => [h.id, h.updatedAt])])
