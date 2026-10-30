// Embeddable note thread mounted inside any detail modal.
import { useState } from 'react'

import { Button, Loader } from '../../components/ui.jsx'
import { useCrudQuery } from '../../hooks.js'
import { formatDateTime } from '../../lib/utils.js'

export default function NotesPanel({ entityType, entityId }) {
  const [draft, setDraft] = useState('')
  const notes = useCrudQuery('notes')
  const { data, isLoading } = notes.useList({ entityType, entityId, sort: '-createdAt' })
  const createNote = notes.useCreate()

  const submit = (e) => {
    e.preventDefault()
    if (!draft.trim()) return
    createNote.mutate({ entityType, entityId, body: draft.trim() }, { onSuccess: () => setDraft('') })
  }

  return (
    <div>
      <form onSubmit={submit} className="mb-4 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a note…"
          className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm dark:border-border-dark dark:bg-surface-dark"
        />
        <Button type="submit" disabled={createNote.isPending || !draft.trim()}>
          Add
        </Button>
      </form>

      {isLoading ? (
        <Loader className="h-4 w-4" />
      ) : data?.data.length ? (
        <ul className="flex flex-col gap-3">
          {data.data.map((note) => (
            <li key={note._id} className="rounded-md border border-border p-3 text-sm dark:border-border-dark">
              <p>{note.body}</p>
              <p className="mt-1 text-xs text-muted dark:text-muted-dark">
                {note.authorId?.name ?? 'Someone'} · {formatDateTime(note.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted dark:text-muted-dark">No notes yet.</p>
      )}
    </div>
  )
}
