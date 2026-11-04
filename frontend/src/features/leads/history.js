// A lead's activities and notes as one timeline (LeadDetailPage).

/** Activities and notes as one list, newest first, by the date each is about (a task's due date, an event's start). */
export function historyOf(activities = [], notes = []) {
  return [
    ...activities.map((a) => ({
      id: a._id,
      kind: a.type,
      title: a.title,
      text: a.description ?? '',
      date: a.dueDate ?? a.startAt ?? a.createdAt,
      status: a.status,
    })),
    ...notes.map((n) => ({ id: n._id, kind: 'note', title: 'Note', text: n.body, date: n.createdAt })),
  ].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
}
