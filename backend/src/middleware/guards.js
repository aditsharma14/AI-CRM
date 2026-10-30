// RBAC permission check (requirePermission) and schema-validation middleware factory.
import { hasPermission } from '../utils/permissions.js'
import { forbidden, badRequest } from '../utils/http.js'

export function requirePermission(resource, action) {
  return (req, res, next) => {
    if (!hasPermission(req.user.role, resource, action)) {
      return next(forbidden(`Your role cannot ${action} ${resource}.`))
    }
    next()
  }
}

/** validate({ body, query, params }) — each key is an optional Zod schema. */
export function validate(schemas) {
  return (req, res, next) => {
    for (const key of ['body', 'query', 'params']) {
      const schema = schemas[key]
      if (!schema) continue
      const result = schema.safeParse(req[key])
      if (!result.success) {
        // Prefix the field, so '?status=nope' says which param was wrong.
        const messages = result.error.issues.map((i) =>
          i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message,
        )
        return next(badRequest(messages.join('; '), 'VALIDATION_ERROR'))
      }
      // Express 5's req.query is a prototype getter that re-parses the URL
      // on every read (never caches), so a plain assignment either throws or
      // silently vanishes. Shadowing it with an own, writable property is the
      // documented way to make a coerced/defaulted query object stick.
      if (key === 'query') {
        Object.defineProperty(req, 'query', {
          value: result.data,
          writable: true,
          configurable: true,
          enumerable: true,
        })
      } else {
        req[key] = result.data
      }
    }
    next()
  }
}
