// The three ways to search leads (S1.9), measured on the seeded big org: mongosh nimbus-bench scripts/bench/search-options.js
// (a) today's text index {name, email} (no orgId prefix), (b) a text index prefixed by orgId, (c) an anchored prefix
// match on a lowercased name with {orgId, nameLower}. Each: the first page (20, newest first) for a few terms, median of
// 5 runs, plus the plan's keys/docs examined. Leaves the database as it found it (the extra field and indexes go).
const org = db.organizations.findOne({ name: 'Bench Big Org' })._id
const TERMS = ['sharma', 'priya', 'kaveri', 'nobody']
const RUNS = 5

const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]
function measure(label, filterFor) {
  for (const term of TERMS) {
    const filter = filterFor(term)
    const times = []
    let rows = 0
    for (let i = 0; i < RUNS; i++) {
      const t = Date.now()
      rows = db.leads.find(filter).sort({ createdAt: -1, _id: -1 }).limit(21).toArray().length
      times.push(Date.now() - t)
    }
    const stats = db.leads
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(21)
      .explain('executionStats').executionStats
    const matches = db.leads.countDocuments(filter)
    print(
      `| ${label} | ${term} | ${matches} | ${rows} | ${stats.totalKeysExamined} | ${stats.totalDocsExamined} | ${median(times)} |`,
    )
  }
}

print('| Option | Term | Matches in org | Page rows | Keys examined | Docs examined | Median ms |')
print('|---|---|---|---|---|---|---|')

// (a) as committed before S1.9
db.leads.dropIndexes()
db.leads.createIndex({ orgId: 1, createdAt: -1, _id: -1 })
db.leads.createIndex({ name: 'text', email: 'text' })
measure('(a) text, no orgId prefix', (q) => ({ orgId: org, $text: { $search: q } }))

// (b) text index with an orgId equality prefix
db.leads.dropIndex('name_text_email_text')
db.leads.createIndex({ orgId: 1, name: 'text', email: 'text' })
measure('(b) text, orgId prefix', (q) => ({ orgId: org, $text: { $search: q } }))

// (c) anchored prefix on a stored lowercase name
db.leads.updateMany({}, [{ $set: { nameLower: { $toLower: '$name' } } }])
db.leads.createIndex({ orgId: 1, nameLower: 1 })
measure('(c) prefix on nameLower', (q) => ({ orgId: org, nameLower: { $regex: `^${q}` } }))

// Restore: the runner's syncIndexes puts back exactly what the models define.
db.leads.updateMany({}, { $unset: { nameLower: '' } })
db.leads.dropIndex('orgId_1_nameLower_1')
