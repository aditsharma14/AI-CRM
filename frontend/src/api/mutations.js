// The page-only writes the API makes idempotent (convert, move-stage, the brief), each sent through idempotent() with
// its own key. Creates go through client.js's createRecord, which useCrudQuery (in the entry chunk) needs.
import { api, idempotent } from './client.js'

/** @returns {Promise<unknown>} The new deal. */
export async function convertLead(id) {
  return (await idempotent((config) => api.post(`/leads/${id}/convert`, undefined, config))).data.data
}

/** @returns {Promise<unknown>} The moved deal. */
export async function moveStage({ id, stageKey }) {
  return (await idempotent((config) => api.patch(`/deals/${id}/move-stage`, { stageKey }, config))).data.data
}

/** The whole response: 200 carries a cached brief, 202 a jobId to poll. */
export function requestBrief(leadId, refresh) {
  return idempotent((config) => api.post(`/ai/leads/${leadId}/brief`, refresh ? { refresh: true } : {}, config))
}
