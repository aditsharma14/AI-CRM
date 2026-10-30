// @ts-check
// Cross-collection search query and dashboard/report aggregations.
import mongoose from 'mongoose'
import { Lead, Contact, Company } from '../models/CRM.js'
import Deal from '../models/Deal.js'
import { ActivityLog } from '../models/Logs.js'

// Aggregation output shapes. Mongoose types every pipeline result as any[],
// so each pipeline's rows are named here and the result cast once at the call.
/** @typedef {{ _id: string, count: number }} CountRow */
/** @typedef {{ _id: string, count: number, value: number }} StageRow */
/** @typedef {{ _id: null, total: number }} TotalRow */
/** @typedef {{ _id: { year: number, month: number, status: 'won' | 'lost' }, count: number, value: number }} MonthRow */

/**
 * @param {string} s
 * @returns {string}
 */
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * @param {string} orgId
 * @param {string} q
 * @param {number} [limit]
 * @returns The first `limit` matches per entity type.
 */
export async function search(orgId, q, limit = 5) {
  if (!q?.trim()) return { leads: [], contacts: [], companies: [], deals: [] }

  const textFilter = { orgId, $text: { $search: q } }
  const dealFilter = { orgId, title: new RegExp(escapeRegex(q), 'i') } // Deal has no text index

  const [leads, contacts, companies, deals] = await Promise.all([
    Lead.find(textFilter).limit(limit),
    Contact.find(textFilter).limit(limit),
    Company.find(textFilter).limit(limit),
    Deal.find(dealFilter).limit(limit),
  ])
  return { leads, contacts, companies, deals }
}

/**
 * @param {string} orgId
 * @returns Lead/deal counts, open pipeline value and the latest audit entries.
 */
export async function dashboardOverview(orgId) {
  const oid = new mongoose.Types.ObjectId(orgId)

  const [leadsByStatus, dealsByStage, openPipeline, recentActivity] = await Promise.all([
    /** @type {Promise<CountRow[]>} */ (
      Lead.aggregate([{ $match: { orgId: oid } }, { $group: { _id: '$status', count: { $sum: 1 } } }]).exec()
    ),
    /** @type {Promise<StageRow[]>} */ (
      Deal.aggregate([{ $match: { orgId: oid } }, { $group: { _id: '$stageKey', count: { $sum: 1 }, value: { $sum: '$value' } } }]).exec()
    ),
    /** @type {Promise<TotalRow[]>} */ (
      Deal.aggregate([{ $match: { orgId: oid, status: 'open' } }, { $group: { _id: null, total: { $sum: '$value' } } }]).exec()
    ),
    ActivityLog.find({ orgId }).sort({ createdAt: -1 }).limit(10).populate('userId', 'name'),
  ])

  return {
    leadsByStatus: Object.fromEntries(leadsByStatus.map((r) => [r._id, r.count])),
    dealsByStage: dealsByStage.map((r) => ({ stageKey: r._id, count: r.count, value: r.value })),
    openPipelineValue: openPipeline[0]?.total ?? 0,
    recentActivity,
  }
}

/**
 * @param {string} orgId
 * @returns Won/lost counts and value per month, plus the overall win rate (null with no closed deals).
 */
export async function dashboardReports(orgId) {
  const oid = new mongoose.Types.ObjectId(orgId)

  const [wonLostByMonth, winRateInputs] = await Promise.all([
    /** @type {Promise<MonthRow[]>} */ (
      Deal.aggregate([
        { $match: { orgId: oid, status: { $in: ['won', 'lost'] }, closedAt: { $ne: null } } },
        {
          $group: {
            _id: { year: { $year: '$closedAt' }, month: { $month: '$closedAt' }, status: '$status' },
            count: { $sum: 1 },
            value: { $sum: '$value' },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]).exec()
    ),
    /** @type {Promise<CountRow[]>} */ (
      Deal.aggregate([{ $match: { orgId: oid, status: { $in: ['won', 'lost'] } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]).exec()
    ),
  ])

  const won = winRateInputs.find((r) => r._id === 'won')?.count ?? 0
  const lost = winRateInputs.find((r) => r._id === 'lost')?.count ?? 0
  const winRate = won + lost > 0 ? won / (won + lost) : null

  return { wonLostByMonth, winRate, won, lost }
}
