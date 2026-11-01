// The response-shape contract shared by the real API and the GitHub Pages demo (frontend/src/demo/). Both test suites
// check their responses against api-shapes.json with checkShape(), so neither can change a shape alone:
//   backend/tests/api-contract.test.js   real responses (UPDATE_CONTRACT=1 rewrites the file from them)
//   frontend/src/demo/contract.test.js   the demo's responses, through the app's own axios client
//
// A shape is one of:
//   "string" | "id" | "date" | "number" | "boolean" | "null", or a union such as "id|null"
//   [element]                an array (an empty [] when no sample had elements: any element passes)
//   { key: shape, "key?": shape, "$null": true }   an object; "?" marks a key some samples lacked, $null that the
//                                                   value itself may be null. Any key not listed is an error.
//   { "$map": shape }        an object keyed by data (e.g. leadsByStatus): any keys, every value of that shape

const ID = /^[0-9a-f]{24}$/
const DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

/** The primitive tag of a JSON value, or 'array' / 'object'. */
export function typeOf(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'string') return ID.test(value) ? 'id' : DATE.test(value) ? 'date' : 'string'
  return typeof value
}

/** The shape of one sample. */
export function shapeOf(value) {
  const type = typeOf(value)
  if (type === 'array') return value.length ? [value.map(shapeOf).reduce(mergeShapes)] : []
  if (type === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shapeOf(v)]))
  return type
}

const isObjectShape = (s) => s !== null && typeof s === 'object' && !Array.isArray(s)
const tags = (s) => s.split('|')
const union = (...lists) => [...new Set(lists.flat())].sort().join('|')

/** The smallest shape both samples satisfy. Throws on samples that disagree beyond null-ability. */
export function mergeShapes(a, b) {
  if (typeof a === 'string' && typeof b === 'string') return union(tags(a), tags(b))
  if (Array.isArray(a) && Array.isArray(b)) {
    if (!a.length || !b.length) return a.length ? a : b
    return [mergeShapes(a[0], b[0])]
  }
  // An object in one sample and null in another: the object, nullable.
  if (isObjectShape(a) && b === 'null') return { ...a, $null: true }
  if (a === 'null' && isObjectShape(b)) return { ...b, $null: true }
  if (isObjectShape(a) && isObjectShape(b)) {
    const plain = (k) => k.replace(/\?$/, '')
    const keysA = new Map(Object.keys(a).map((k) => [plain(k), k]))
    const keysB = new Map(Object.keys(b).map((k) => [plain(k), k]))
    const out = {}
    for (const key of new Set([...keysA.keys(), ...keysB.keys()])) {
      if (key === '$null') continue
      const ka = keysA.get(key)
      const kb = keysB.get(key)
      const optional = !ka || !kb || ka.endsWith('?') || kb.endsWith('?')
      const shape = ka && kb ? mergeShapes(a[ka], b[kb]) : (a[ka] ?? b[kb])
      out[optional ? `${key}?` : key] = shape
    }
    if (a.$null || b.$null) out.$null = true
    return out
  }
  throw new Error(`samples disagree: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`)
}

/**
 * Every way `value` breaks `shape`, as "path: problem" strings; [] when it conforms.
 * "string" also accepts ids and dates (they are strings); "id" and "date" accept only their own format.
 */
export function checkShape(shape, value, path = '$') {
  const type = typeOf(value)
  if (typeof shape === 'string') {
    const allowed = tags(shape)
    const ok = allowed.includes(type) || (allowed.includes('string') && (type === 'id' || type === 'date'))
    return ok
      ? []
      : [`${path}: expected ${shape}, got ${type === 'object' || type === 'array' ? type : JSON.stringify(value)}`]
  }
  if (Array.isArray(shape)) {
    if (type !== 'array') return [`${path}: expected an array, got ${type}`]
    if (!shape.length) return []
    return value.flatMap((item, i) => checkShape(shape[0], item, `${path}[${i}]`))
  }
  if (value === null && shape.$null) return []
  if (type !== 'object') return [`${path}: expected an object, got ${type}`]
  if (shape.$map) return Object.entries(value).flatMap(([k, v]) => checkShape(shape.$map, v, `${path}.${k}`))
  const errors = []
  const listed = new Set()
  for (const [rawKey, child] of Object.entries(shape)) {
    if (rawKey === '$null') continue
    const optional = rawKey.endsWith('?')
    const key = optional ? rawKey.slice(0, -1) : rawKey
    listed.add(key)
    if (!(key in value)) {
      if (!optional) errors.push(`${path}.${key}: missing`)
      continue
    }
    errors.push(...checkShape(child, value[key], `${path}.${key}`))
  }
  for (const key of Object.keys(value)) if (!listed.has(key)) errors.push(`${path}.${key}: not in the contract`)
  return errors
}
