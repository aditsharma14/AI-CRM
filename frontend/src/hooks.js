// Generic reusable hooks: useCrudQuery, useDebounce, useDisclosure, usePaginationState, useClickOutside,
// useMutationError, usePipelineStages, useAppConfig.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { api, createRecord } from './api/client.js'
import { apiErrorMessage, SAVE_FAILED, splitFieldErrors } from './lib/utils.js'

/**
 * Generic CRUD data-fetching for any REST resource. A new entity gets full
 * list/create/update/delete behavior from one call, e.g.:
 *   const leads = useCrudQuery('leads')
 *   const { data } = leads.useList({ status: 'new' })
 */
export function useCrudQuery(resource) {
  const useList = (params = {}) =>
    useQuery({
      queryKey: [resource, 'list', params],
      queryFn: async () => (await api.get(`/${resource}`, { params })).data,
    })

  const useCreate = () => {
    const queryClient = useQueryClient()
    return useMutation({
      mutationFn: (payload) => createRecord(resource, payload),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: [resource] }),
    })
  }

  const useUpdate = () => {
    const queryClient = useQueryClient()
    return useMutation({
      mutationFn: async ({ id, ...payload }) => (await api.patch(`/${resource}/${id}`, payload)).data.data,
      onSuccess: () => queryClient.invalidateQueries({ queryKey: [resource] }),
    })
  }

  const useRemove = () => {
    const queryClient = useQueryClient()
    return useMutation({
      mutationFn: async (id) => (await api.delete(`/${resource}/${id}`)).data.data,
      onSuccess: () => queryClient.invalidateQueries({ queryKey: [resource] }),
    })
  }

  return { useList, useCreate, useUpdate, useRemove }
}

export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export function useDisclosure(initial = false) {
  const [isOpen, setIsOpen] = useState(initial)
  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])
  return { isOpen, open, close }
}

/**
 * The current page of a list, tied to the filters it was chosen under: when
 * `filters` change (search, status…) the page is 1 again, so a filter applied
 * on page 3 can't land on an empty page. Derived during render rather than
 * reset in an effect, so the stale page is never requested.
 *   const { page, limit, setPage } = usePaginationState({ q, status })
 */
export function usePaginationState(filters = {}, { limit = 20 } = {}) {
  const key = JSON.stringify(filters)
  const [chosen, setChosen] = useState({ key, page: 1 })
  const page = chosen.key === key ? chosen.page : 1
  const setPage = useCallback((next) => setChosen({ key, page: next }), [key])
  return { page, limit, setPage }
}

/**
 * Cursor pagination for the lists that use it (leads, deals): `cursor` is the one to request, and Prev goes back
 * through the cursors already seen. Like usePaginationState, the stack belongs to the `filters` it was built under
 * (search, status, sort…), so a change starts again at page 1; the API would refuse an old cursor anyway (400).
 *   const pager = useCursorPagination({ q, status })
 *   useList({ cursor: pager.cursor, limit: pager.limit, q, status })
 *   <DataTable cursorPager={{ ...pager, hasMore: meta.hasMore, onNext: () => pager.next(meta.nextCursor) }} />
 */
export function useCursorPagination(filters = {}, { limit = 20 } = {}) {
  const key = JSON.stringify(filters)
  const [chosen, setChosen] = useState({ key, stack: [] })
  const stack = chosen.key === key ? chosen.stack : []
  const next = useCallback(
    (nextCursor) => nextCursor && setChosen((c) => ({ key, stack: [...(c.key === key ? c.stack : []), nextCursor] })),
    [key],
  )
  const prev = useCallback(() => setChosen((c) => ({ key, stack: (c.key === key ? c.stack : []).slice(0, -1) })), [key])
  return { cursor: stack.at(-1), limit, page: stack.length + 1, hasPrev: stack.length > 0, next, prev }
}

/**
 * Closes a dropdown/menu when the user clicks anywhere outside it.
 * Attach `ref` to the dropdown's wrapping element:
 *   const ref = useRef(null)
 *   useClickOutside(ref, () => setOpen(false))
 *   <div ref={ref}>...menu...</div>
 */
export function useClickOutside(ref, onOutsideClick) {
  useEffect(() => {
    const handleClick = (event) => {
      if (ref.current && !ref.current.contains(event.target)) onOutsideClick()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [ref, onOutsideClick])
}

/**
 * The latest error across one or more mutations (a form's save, convert,
 * delete…), ready for <ErrorAlert message={…} />.
 *   const saveError = useMutationError(createLead, updateLead)
 *   <ErrorAlert message={saveError.message} />
 * forFields(names) moves a 400's issues for those fields under the fields:
 *   const { fieldErrors, message } = saveError.forFields(['password'])
 *   <FormField error={errors.password ?? fieldErrors.password}> … <ErrorAlert message={message} />
 */
export function useMutationError(...mutations) {
  // Several can have failed; show the one the user triggered last.
  const failed = mutations.filter((m) => m.isError).sort((a, b) => b.submittedAt - a.submittedAt)[0]
  const error = failed?.error ?? null
  return {
    error,
    message: error ? apiErrorMessage(error, { serverError: SAVE_FAILED }) : null,
    forFields: (fields) => splitFieldErrors(error, fields, { serverError: SAVE_FAILED }),
    reset: () => mutations.forEach((m) => m.reset()),
  }
}

/**
 * The org's pipeline stages (Settings → Pipeline edits them), sorted by
 * `order` — never a hardcoded list, since every org can rename, add or
 * reorder its own. Shares the Settings tab's cache key, so a saved edit
 * shows up everywhere.
 */
export function usePipelineStages() {
  const { data, isLoading } = useQuery({
    queryKey: ['org', 'pipeline-stages'],
    queryFn: async () => (await api.get('/org/pipeline-stages')).data.data,
    staleTime: 5 * 60_000,
  })
  const stages = useMemo(() => [...(data ?? [])].sort((a, b) => a.order - b.order), [data])
  // A deal can sit in a stage the org has since removed: show its raw key.
  const labelFor = useCallback((key) => stages.find((s) => s.key === key)?.label ?? key, [stages])
  const positionOf = useCallback(
    (key) => {
      const i = stages.findIndex((s) => s.key === key)
      return i === -1 ? stages.length : i
    },
    [stages],
  )
  return { stages, labelFor, positionOf, isLoading }
}

/**
 * What the API says this deployment can offer (public GET /config), e.g. whether there is email for password reset
 * (S2.6). Until it answers, email counts as off, so nothing is offered that might not work.
 */
export function useAppConfig() {
  const { data, isLoading } = useQuery({
    queryKey: ['config'],
    queryFn: async () => (await api.get('/config')).data.data,
    staleTime: Infinity,
  })
  return { emailEnabled: data?.emailEnabled ?? false, aiEnabled: data?.aiEnabled ?? false, isLoading }
}
