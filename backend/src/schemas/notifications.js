// @ts-check
// Notification and activity-log list schemas — validators plus z.infer input types.
import { booleanParam, listQuery, paginationQuery } from '../utils/validators.js'

// Shared by the route (listQuery) and the service (filterableFields/sortableFields).
export const notificationList = {
  filters: { read: booleanParam.optional() },
  sort: ['createdAt'],
}
export const notificationListQuery = listQuery(notificationList)

export const activityLogQuery = paginationQuery

/** @typedef {import('zod').infer<typeof notificationListQuery>} NotificationListQuery */
/** @typedef {import('zod').infer<typeof activityLogQuery>} ActivityLogQuery */
