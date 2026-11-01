// The demo's starting data: a fictional Pune office-supplies distributor, its sales manager and one rep, INR deals in
// every stage, and 60 days of tasks, meetings, notes and history. Dates are relative to `now`, so it never goes stale.

const DAY = 24 * 60 * 60 * 1000

/**
 * A 24-hex id like a Mongo ObjectId (the contract checks the format): a two-digit kind, zeros, then the number.
 * No kind is a prefix of another, so ids never collide.
 */
export const oid = (kind, n) => kind + n.toString(16).padStart(22, '0')
export const KIND = {
  org: '0a',
  user: '0b',
  company: '0c',
  contact: '0d',
  lead: '0e',
  deal: '0f',
  activity: '1a',
  note: '1b',
  log: '1c',
  notification: '1d',
  team: '1e',
  template: '1f',
}

// Same as backend/src/models/Organization.js DEFAULT_PIPELINE_STAGES.
const STAGES = [
  { key: 'new', label: 'New', order: 0 },
  { key: 'qualified', label: 'Qualified', order: 1 },
  { key: 'proposal', label: 'Proposal', order: 2 },
  { key: 'negotiation', label: 'Negotiation', order: 3 },
  { key: 'won', label: 'Closed Won', order: 4 },
  { key: 'lost', label: 'Closed Lost', order: 5 },
]

const ORG_ID = oid(KIND.org, 1)
export const MANAGER_ID = oid(KIND.user, 1)
export const MEMBER_ID = oid(KIND.user, 2)

/** The two people a visitor can sign in as (any password; the demo has no credentials). */
export const DEMO_ACCOUNTS = {
  manager: { email: 'priya.nair@kaveri.example', label: 'Try as Sales Manager' },
  member: { email: 'arjun.mehta@kaveri.example', label: 'Try as Member' },
}

const COMPANIES = [
  ['Sahyadri Traders', 'sahyadri-traders.example', 'Retail', '11-50', MANAGER_ID, 58],
  ['Deccan Pharma Distributors', 'deccanpharma.example', 'Healthcare', '51-200', MANAGER_ID, 57],
  ['Godavari Textiles', 'godavaritex.example', 'Manufacturing', '201-1000', MEMBER_ID, 55],
  ['Malabar Spice Exports', 'malabarspice.example', 'Export', '11-50', MEMBER_ID, 52],
  ['Vindhya Infra Projects', 'vindhyainfra.example', 'Construction', '51-200', MANAGER_ID, 50],
  ['Konkan Coast Resorts', 'konkanresorts.example', 'Hospitality', '51-200', MEMBER_ID, 47],
  ['Narmada Auto Components', 'narmada-auto.example', 'Automotive', '201-1000', MANAGER_ID, 44],
  ['Shivneri Schools Trust', 'shivneri.example', 'Education', '51-200', MEMBER_ID, 40],
  ['Tapti Logistics', 'taptilogistics.example', 'Logistics', '11-50', MANAGER_ID, 33],
  ['Kaveri Co-operative Bank', 'kaveribank.example', 'Finance', '201-1000', MEMBER_ID, 21],
]

// name, email, phone, title, company #, owner, days ago, tags
const CONTACTS = [
  [
    'Meera Kulkarni',
    'meera@sahyadri-traders.example',
    '+91 98220 41123',
    'Purchase Head',
    1,
    MANAGER_ID,
    58,
    ['decision-maker'],
  ],
  ['Rohit Joshi', 'rohit.j@sahyadri-traders.example', '+91 98901 22004', 'Store Manager', 1, MANAGER_ID, 56, []],
  [
    'Dr. Sunita Rao',
    'sunita.rao@deccanpharma.example',
    '+91 99230 55812',
    'Director',
    2,
    MANAGER_ID,
    57,
    ['decision-maker'],
  ],
  ['Kiran Patil', 'kiran@deccanpharma.example', '+91 97650 10093', 'Admin Officer', 2, MANAGER_ID, 49, []],
  ['Anand Iyer', 'anand.iyer@godavaritex.example', '+91 98450 77431', 'Plant Head', 3, MEMBER_ID, 55, ['technical']],
  ['Fatima Shaikh', 'fatima@godavaritex.example', '+91 90110 34567', 'Procurement', 3, MEMBER_ID, 41, []],
  ['Joseph Thomas', 'joseph@malabarspice.example', '+91 94470 21890', 'Owner', 4, MEMBER_ID, 52, ['decision-maker']],
  ['Vikram Singh', 'vikram@vindhyainfra.example', '+91 98110 66720', 'Projects GM', 5, MANAGER_ID, 50, []],
  ['Neha Gupta', 'neha.g@vindhyainfra.example', '+91 98710 45021', 'Accounts', 5, MANAGER_ID, 36, ['billing']],
  ['Sameer Naik', 'sameer@konkanresorts.example', '+91 98230 99110', 'Operations', 6, MEMBER_ID, 47, []],
  [
    'Lakshmi Menon',
    'lakshmi@narmada-auto.example',
    '+91 99000 12345',
    'Supply Chain Lead',
    7,
    MANAGER_ID,
    44,
    ['decision-maker'],
  ],
  ['Pradeep Deshmukh', 'principal@shivneri.example', '+91 97300 88214', 'Principal', 8, MEMBER_ID, 40, []],
  ['Harpreet Kaur', 'harpreet@taptilogistics.example', '+91 98150 30311', 'Office Manager', 9, MANAGER_ID, 33, []],
  ['Aditya Bhosale', 'aditya.b@kaveribank.example', '+91 98600 72290', 'Branch Admin', 10, MEMBER_ID, 21, []],
]

// name, email, phone, source, status, company # (or 0), owner, days ago
const LEADS = [
  ['Ganesh Pawar', 'ganesh.pawar@gmail.example', '+91 98810 11201', 'IndiaMART', 'new', 0, MEMBER_ID, 2],
  ['Ritu Agarwal', 'ritu@agarwalcpa.example', '+91 98300 55219', 'Website', 'new', 0, MANAGER_ID, 1],
  ['Swati Kale', null, '+91 90040 67112', 'Walk-in', 'new', 0, MEMBER_ID, 4],
  ['Imran Qureshi', 'imran@qureshibuilders.example', null, 'JustDial', 'contacted', 0, MEMBER_ID, 9],
  ['Pooja Hegde', 'pooja@hegdeclinic.example', '+91 98450 31222', 'Referral', 'contacted', 0, MANAGER_ID, 12],
  ['Nitin Wagh', 'nitin@waghautomobiles.example', '+91 98220 90876', 'Trade fair', 'contacted', 7, MANAGER_ID, 16],
  ['Snehal More', 'snehal@konkanresorts.example', '+91 98230 99117', 'Referral', 'qualified', 6, MEMBER_ID, 19],
  ['Rajesh Khanna', 'rajesh@taptilogistics.example', '+91 98150 30388', 'LinkedIn', 'qualified', 9, MANAGER_ID, 24],
  ['Divya Pillai', 'divya@pillaiandsons.example', '+91 94460 22188', 'Website', 'qualified', 0, MEMBER_ID, 27],
  ['Manoj Tiwari', null, '+91 98390 41520', 'Cold call', 'unqualified', 0, MEMBER_ID, 31],
  ['Asha Bhatt', 'asha@bhattstationers.example', '+91 98250 61190', 'IndiaMART', 'unqualified', 0, MANAGER_ID, 38],
  ['Kunal Shah', 'kunal@shivneri.example', '+91 97300 88290', 'Referral', 'converted', 8, MEMBER_ID, 39],
  ['Farhan Ali', 'farhan@narmada-auto.example', '+91 99000 12399', 'Trade fair', 'converted', 7, MANAGER_ID, 43],
  ['Rekha Nambiar', 'rekha@malabarspice.example', '+91 94470 21811', 'Website', 'converted', 4, MEMBER_ID, 51],
]

// title, value (INR), stage, probability, company #, contact #s, owner, days ago, closed days ago, reason, from lead #
const DEALS = [
  ['Ganesh Pawar: home office set-up', 45000, 'new', 20, 0, [], MEMBER_ID, 2, null, null, null],
  ['Agarwal CPA: annual stationery', 84000, 'new', 25, 0, [], MANAGER_ID, 3, null, null, null],
  ['Kaveri Bank: branch printer AMC', 360000, 'qualified', 40, 10, [14], MEMBER_ID, 18, null, null, null],
  ['Tapti Logistics: label printers', 125000, 'qualified', 45, 9, [13], MANAGER_ID, 22, null, null, null],
  ['Shivneri Schools: new academic year kits', 640000, 'qualified', 50, 8, [12], MEMBER_ID, 37, null, null, 12],
  ['Vindhya Infra: site office furniture', 1150000, 'proposal', 55, 5, [8, 9], MANAGER_ID, 34, null, null, null],
  ['Deccan Pharma: compliance filing cabinets', 410000, 'proposal', 60, 2, [3], MANAGER_ID, 29, null, null, null],
  ['Konkan Resorts: front-desk supplies', 98000, 'proposal', 50, 6, [10], MEMBER_ID, 20, null, null, null],
  [
    'Narmada Auto: shop-floor consumables (yearly)',
    1800000,
    'negotiation',
    75,
    7,
    [11],
    MANAGER_ID,
    41,
    null,
    null,
    13,
  ],
  ['Godavari Textiles: ergonomic chairs', 720000, 'negotiation', 70, 3, [5, 6], MEMBER_ID, 33, null, null, null],
  [
    'Sahyadri Traders: Diwali gifting order',
    265000,
    'won',
    100,
    1,
    [1],
    MANAGER_ID,
    54,
    46,
    'Best delivery timeline',
    null,
  ],
  ['Malabar Spice: export documentation kits', 152000, 'won', 100, 4, [7], MEMBER_ID, 48, 30, 'Repeat customer', 14],
  [
    'Deccan Pharma: printer cartridges (quarterly)',
    188000,
    'won',
    100,
    2,
    [4],
    MANAGER_ID,
    39,
    17,
    'Matched last vendor price',
    null,
  ],
  ['Sahyadri Traders: billing counter rolls', 62000, 'won', 100, 1, [2], MANAGER_ID, 15, 6, 'Fast quote', null],
  [
    'Vindhya Infra: drafting supplies',
    210000,
    'lost',
    0,
    5,
    [8],
    MANAGER_ID,
    52,
    38,
    'Went with an online marketplace',
    null,
  ],
  [
    'Konkan Resorts: housekeeping trolleys',
    340000,
    'lost',
    0,
    6,
    [10],
    MEMBER_ID,
    45,
    12,
    'Budget moved to next year',
    null,
  ],
]

// type, title, description, priority, assignee, due/start (days from now, hour), status, link [kind, #]
const ACTIVITIES = [
  [
    'task',
    'Send revised quote with GST breakup',
    'Narmada wants 18% GST shown per line item.',
    'high',
    MANAGER_ID,
    [1, 11],
    'open',
    ['deal', 9],
  ],
  ['task', 'Confirm chair samples reached Godavari', null, 'medium', MEMBER_ID, [0, 16], 'open', ['deal', 10]],
  [
    'task',
    'Follow up on Vindhya furniture proposal',
    'Ask whether the CFO has seen it.',
    'high',
    MANAGER_ID,
    [-1, 12],
    'open',
    ['deal', 6],
  ],
  ['task', 'Call Ganesh about delivery address', null, 'low', MEMBER_ID, [2, 10], 'open', ['lead', 1]],
  [
    'task',
    'Prepare school kit price list',
    'Classes 1 to 10, with and without bags.',
    'medium',
    MEMBER_ID,
    [4, 15],
    'open',
    ['deal', 5],
  ],
  ['task', 'Collect payment for Diwali order', null, 'high', MANAGER_ID, [-40, 11], 'done', ['deal', 11]],
  ['task', 'Share cartridge compatibility sheet', null, 'medium', MANAGER_ID, [-20, 14], 'done', ['deal', 13]],
  ['task', 'Update Konkan contact after the lost deal', null, 'low', MEMBER_ID, [-10, 17], 'done', ['contact', 10]],
  ['task', 'Qualify Agarwal CPA requirements', null, 'medium', MANAGER_ID, [6, 11], 'open', ['lead', 2]],
  ['task', 'Renew Kaveri Bank AMC terms draft', null, 'medium', MEMBER_ID, [-3, 15], 'open', ['deal', 3]],
  [
    'meeting',
    'Site visit: Vindhya Infra Hinjewadi office',
    'Measure the site office for furniture.',
    null,
    MANAGER_ID,
    [-25, 11],
    'done',
    ['company', 5],
  ],
  ['meeting', 'Demo: label printers at Tapti warehouse', null, null, MANAGER_ID, [3, 15], 'open', ['deal', 4]],
  ['call', 'Weekly call with Malabar Spice', null, null, MEMBER_ID, [1, 10], 'open', ['company', 4]],
  ['event', 'Office Expo Pune 2026 stall', 'Hall 3, stall B-12.', null, MANAGER_ID, [-50, 10], 'done', null],
  ['event', 'Shivneri Schools purchase committee', null, null, MEMBER_ID, [8, 12], 'open', ['deal', 5]],
  ['meeting', 'Quarterly review: Deccan Pharma', null, null, MANAGER_ID, [-5, 16], 'done', ['company', 2]],
  ['event', 'Team target review', 'Q3 numbers and the Diwali push.', null, MANAGER_ID, [10, 17], 'open', null],
]

// entity [kind, #], body, author, days ago
const NOTES = [
  [['deal', 9], 'Lakshmi confirmed the yearly volume: about 1,200 units a month across both plants.', MANAGER_ID, 40],
  [['deal', 9], 'They are comparing us with a Chakan vendor on price. Our edge is next-day delivery.', MANAGER_ID, 12],
  [['deal', 9], 'Asked for 45-day credit instead of 30. Checking with accounts.', MANAGER_ID, 3],
  [['deal', 10], 'Plant head wants 10 sample chairs for a two-week trial.', MEMBER_ID, 30],
  [['deal', 10], 'Samples dispatched by road; ETA Thursday.', MEMBER_ID, 2],
  [['deal', 6], 'Proposal sent: 42 workstations, 6 cabins, conference table.', MANAGER_ID, 20],
  [['deal', 6], 'Vikram says the CFO signs anything above 10 lakh.', MANAGER_ID, 8],
  [['deal', 11], 'Delivered all 300 gift hampers two days early.', MANAGER_ID, 46],
  [['deal', 12], 'Joseph wants the same kit every quarter. Set a reminder.', MEMBER_ID, 29],
  [['deal', 15], 'Lost to an online marketplace on price. Keep in touch for the next project.', MANAGER_ID, 38],
  [['deal', 16], 'Budget frozen until April. Revisit then.', MEMBER_ID, 12],
  [['deal', 5], 'Principal shared last year’s order: 1,800 kits.', MEMBER_ID, 35],
  [['lead', 1], 'Works from home in Baner; wants a desk, chair and a printer.', MEMBER_ID, 2],
  [['lead', 5], 'Clinic opening in December. Call again in two weeks.', MANAGER_ID, 11],
  [['lead', 8], 'Rajesh handles procurement for three warehouses.', MANAGER_ID, 23],
  [['contact', 1], 'Prefers WhatsApp over email.', MANAGER_ID, 55],
  [['contact', 7], 'Family business; his daughter now places the orders.', MEMBER_ID, 50],
  [['company', 7], 'Two plants: Chakan and Ranjangaon.', MANAGER_ID, 44],
]

const TEMPLATES = [
  [
    'Quote follow-up',
    'Your quote from Kaveri Office Solutions',
    'Hi {{name}},\n\nJust checking you received our quote. Happy to adjust quantities.\n\nPriya',
  ],
  [
    'Thank you for your order',
    'Thank you, {{company}}',
    'Hi {{name}},\n\nThank you for the order. Delivery details follow shortly.\n\nKaveri Office Solutions',
  ],
]

/**
 * A fresh copy of the demo's data, dated relative to `now`.
 * @param {Date} [now]
 */
export function createSeed(now = new Date()) {
  const at = (daysAgo, hour = 10) => {
    const d = new Date(now.getTime() - daysAgo * DAY)
    d.setUTCHours(hour - 5, 30, 0, 0) // :30 past the hour in IST
    return d.toISOString()
  }
  const stamps = (daysAgo, hour) => ({ createdAt: at(daysAgo, hour), updatedAt: at(daysAgo, hour) })

  const USERS = [
    {
      _id: MANAGER_ID,
      name: 'Priya Nair',
      email: DEMO_ACCOUNTS.manager.email,
      role: 'manager',
      isEmailVerified: true,
      createdAt: at(60),
    },
    {
      _id: MEMBER_ID,
      name: 'Arjun Mehta',
      email: DEMO_ACCOUNTS.member.email,
      role: 'member',
      isEmailVerified: true,
      createdAt: at(60),
    },
  ]

  const org = {
    _id: ORG_ID,
    name: 'Kaveri Office Solutions',
    plan: 'trial',
    currency: 'INR',
    ownerId: MANAGER_ID,
    teams: [{ name: 'Pune West', memberIds: [MANAGER_ID, MEMBER_ID], _id: oid(KIND.team, 1), ...stamps(60) }],
    pipelineStages: STAGES,
    emailTemplates: [],
    ...stamps(60),
    __v: 0,
  }
  const emailTemplates = TEMPLATES.map(([tName, subject, body], i) => ({
    name: tName,
    subject,
    body,
    _id: oid(KIND.template, i + 1),
    ...stamps(59 - i),
  }))

  const companies = COMPANIES.map(([cName, domain, industry, size, ownerId, days], i) => ({
    _id: oid(KIND.company, i + 1),
    orgId: ORG_ID,
    name: cName,
    domain,
    industry,
    size,
    ownerId,
    ...stamps(days),
    __v: 0,
  }))
  const companyId = (n) => (n ? oid(KIND.company, n) : undefined)

  const contacts = CONTACTS.map(([cName, email, phone, title, company, ownerId, days, tags], i) => ({
    _id: oid(KIND.contact, i + 1),
    orgId: ORG_ID,
    name: cName,
    email,
    phone,
    title,
    companyId: companyId(company),
    ownerId,
    tags,
    ...stamps(days),
    __v: 0,
  }))

  const deals = DEALS.map(
    ([title, value, stageKey, probability, company, contactNos, ownerId, days, closed, reason, fromLead], i) => {
      const deal = {
        _id: oid(KIND.deal, i + 1),
        orgId: ORG_ID,
        title,
        value,
        currency: 'INR',
        stageKey,
        probability,
        companyId: companyId(company),
        contactIds: contactNos.map((n) => oid(KIND.contact, n)),
        ownerId,
        status: stageKey === 'won' || stageKey === 'lost' ? stageKey : 'open',
        ...stamps(days),
        __v: 0,
      }
      if (closed != null) Object.assign(deal, { closedAt: at(closed, 15), updatedAt: at(closed, 15) })
      if (reason) deal.wonLostReason = reason
      if (fromLead) deal.convertedFromLeadId = oid(KIND.lead, fromLead)
      return deal
    },
  )
  const dealFromLead = new Map(deals.filter((d) => d.convertedFromLeadId).map((d) => [d.convertedFromLeadId, d]))

  const leads = LEADS.map(([lName, email, phone, source, status, company, ownerId, days], i) => {
    const lead = {
      _id: oid(KIND.lead, i + 1),
      orgId: ORG_ID,
      name: lName,
      email: email ?? undefined,
      phone: phone ?? undefined,
      source,
      status,
      score: 0,
      companyId: companyId(company),
      ownerId,
      ...stamps(days),
      __v: 0,
    }
    const deal = dealFromLead.get(lead._id)
    if (deal)
      Object.assign(lead, { convertedToDealId: deal._id, convertedAt: deal.createdAt, updatedAt: deal.createdAt })
    return lead
  })

  const entityId = ([kind, n]) => oid(KIND[kind], n)
  const activities = ACTIVITIES.map(
    ([type, title, description, priority, assigneeId, [inDays, hour], status, link], i) => {
      const when = at(-inDays, hour)
      const activity = {
        _id: oid(KIND.activity, i + 1),
        orgId: ORG_ID,
        type,
        title,
        assigneeId,
        allDay: false,
        status,
        createdAt: at(Math.max(-inDays, 0) + 3, 9),
        updatedAt: at(Math.max(-inDays, 0), 9),
        __v: 0,
      }
      if (description) activity.description = description
      if (priority) activity.priority = priority
      if (type === 'task') activity.dueDate = when
      else Object.assign(activity, { startAt: when, endAt: new Date(Date.parse(when) + 60 * 60 * 1000).toISOString() })
      if (link) activity.linkedTo = { entityType: link[0], entityId: entityId(link) }
      return activity
    },
  )

  const notes = NOTES.map(([entity, body, authorId, days], i) => ({
    _id: oid(KIND.note, i + 1),
    orgId: ORG_ID,
    entityType: entity[0],
    entityId: entityId(entity),
    body,
    authorId,
    ...stamps(days, 12 + (i % 6)),
    __v: 0,
  }))

  // The audit trail the backend would have written for the above (it logs leads, deals and new activities, not
  // contacts, companies or notes), and the notifications it would have sent.
  const logs = []
  const notifications = []
  const log = (userId, action, entityType, record, message, when) =>
    logs.push({
      _id: oid(KIND.log, logs.length + 1),
      orgId: ORG_ID,
      userId,
      entityType,
      entityId: record._id,
      message,
      kind: 'activity_log',
      action,
      createdAt: when,
      updatedAt: when,
      __v: 0,
    })
  const notify = (userId, entityType, record, message, when, read) =>
    notifications.push({
      _id: oid(KIND.notification, notifications.length + 1),
      orgId: ORG_ID,
      userId,
      entityType,
      entityId: record._id,
      message,
      kind: 'notification',
      read,
      createdAt: when,
      updatedAt: when,
      __v: 0,
    })
  for (const l of leads) log(l.ownerId, 'create', 'lead', l, `Created lead "${l.name}"`, l.createdAt)
  for (const d of deals) {
    log(d.ownerId, 'create', 'deal', d, `Created deal "${d.title}"`, d.createdAt)
    if (d.convertedFromLeadId) {
      const lead = leads.find((l) => l._id === d.convertedFromLeadId)
      log(lead.ownerId, 'convert', 'lead', lead, `Converted lead "${lead.name}" into a deal`, d.createdAt)
      notify(lead.ownerId, 'deal', d, `Lead "${lead.name}" was converted into a deal.`, d.createdAt, true)
    }
    if (d.closedAt) {
      const label = STAGES.find((s) => s.key === d.stageKey).label
      log(d.ownerId, 'move-stage', 'deal', d, `Moved deal "${d.title}" to ${label}`, d.closedAt)
      notify(
        d.ownerId,
        'deal',
        d,
        `Deal "${d.title}" was marked ${d.stageKey}.`,
        d.closedAt,
        Date.parse(d.closedAt) < now.getTime() - 10 * DAY,
      )
    }
  }
  for (const a of activities) log(a.assigneeId, 'create', 'activity', a, `Created ${a.type} "${a.title}"`, a.createdAt)
  logs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  return {
    org,
    users: USERS,
    emailTemplates,
    companies,
    contacts,
    leads,
    deals,
    activities,
    notes,
    logs,
    notifications,
  }
}
