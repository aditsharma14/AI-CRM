// Generic reusable hooks: useCrudQuery, useDebounce, useDisclosure, usePaginationState.
import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api/client.js'

/**
 * Generic CRUD data-fetching for any REST resource. A new entity gets full
 * list/detail/create/update/delete behavior from one call, e.g.:
 *   const leads = useCrudQuery('leads')
 *   const { data } = leads.useList({ status: 'new' })
 */
export function useCrudQuery(resource) {
  const useList = (params = {}) =>
    useQuery({
      queryKey: [resource, 'list', params],
      queryFn: async () => (await api.get(`/${resource}`, { params })).data,
    })

  const useItem = (id) =>
    useQuery({
      queryKey: [resource, 'detail', id],
      queryFn: async () => (await api.get(`/${resource}/${id}`)).data.data,
      enabled: Boolean(id),
    })

  const useCreate = () => {
    const queryClient = useQueryClient()
    return useMutation({
      mutationFn: async (payload) => (await api.post(`/${resource}`, payload)).data.data,
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

  return { useList, useItem, useCreate, useUpdate, useRemove }
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
  const toggle = useCallback(() => setIsOpen((v) => !v), [])
  return { isOpen, open, close, toggle }
}

export function usePaginationState(initial = { page: 1, limit: 20 }) {
  const [page, setPage] = useState(initial.page)
  const [limit, setLimit] = useState(initial.limit)
  const nextPage = useCallback(() => setPage((p) => p + 1), [])
  const prevPage = useCallback(() => setPage((p) => Math.max(1, p - 1)), [])
  return { page, limit, setPage, setLimit, nextPage, prevPage }
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
