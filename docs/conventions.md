# Conventions

Detail behind the rules in [CLAUDE.md](../CLAUDE.md). CLAUDE.md says *what* the rules are; this file shows *how*.

## Types: JSDoc checked by `tsc --checkJs`

The backend stays JavaScript and has no build step. [backend/tsconfig.json](../backend/tsconfig.json) (`strict`,
`noUncheckedIndexedAccess`, `noEmit`) checks only files whose first line is `// @ts-check`.
[checked-folders.js](../backend/scripts/checked-folders.js) lists the folders where *every* file must carry it.
`npm run typecheck` enforces that list, and ESLint's JSDoc rules (`require-param`, `require-returns`, `check-types`,
`no-undefined-types`) apply to the same folders.

**Status:**
- **Checked:** `src/types`, `src/utils`, `src/policies`, `src/schemas`, `src/models`, `src/services`.
- **Strict-checked test helper:** [tests/factories.js](../backend/tests/factories.js).
- **Not yet checked:** `src/routes`, `src/middleware`, `src/config`, `src/app.js`, `src/server.js`.

**Migrating a folder:**
1. Add `// @ts-check` as the first line of every file in it.
2. Add the folder to `CHECKED_FOLDERS`.
3. Make `npm run typecheck` pass.
4. Commit it on its own (one folder per commit).

### One example of each pattern
- **Shared typedef.** Shared types live in [src/types/index.js](../backend/src/types/index.js) and are imported where used:
  ```js
  /** @typedef {import('../types/index.js').AuthUser} AuthUser */
  ```
- **Types from Zod (`z.infer`).** Never hand-write a request type. Each file in
  [src/schemas/](../backend/src/schemas/) exports one next to its schema:
  ```js
  /** @typedef {z.infer<typeof leadCreate>} LeadCreateInput */
  ```
  Services then take `@param {import('../schemas/leads.js').LeadConvertInput} input`. Change the schema and the
  service signature changes with it.
- **Generics (`@template`).** See `createCrudService` in [crudService.js](../backend/src/services/crudService.js):
  ```js
  /**
   * @template T Raw document shape of the model (e.g. LeadRecord).
   * @param {import('mongoose').Model<T>} Model
   */
  ```
  Model typedefs come from the schema: `InferSchemaType<typeof leadSchema>` (`LeadRecord`, `DealRecord`, …).
- **Request extension.** [src/types/express.d.ts](../backend/src/types/express.d.ts) is the only `.d.ts`. It adds
  `user?: AuthUser` to `Express.Request` via `declare global`.

### Escape hatches
- No `any`, `@ts-ignore` or `@ts-nocheck`.
- If something must be forced, use a cast `/** @type {X} */ (expr)` with a `// Boundary cast:` comment saying why.
- Prefer `@ts-expect-error <reason>` over `@ts-ignore`.
- **Current count:** 0 `any`, 0 ignores, 0 expect-errors, 4 boundary casts (generic `T` in `crudService` ×2, and the
  env-sourced JWT secret and TTL in `authService`).

### Mongoose quirks
- Assign DocumentArrays with `doc.set('field', value)`, not `doc.field = [...]`.
- Declare instance methods in the schema's `methods` option, so the types can see them (see `comparePassword` in
  [User.js](../backend/src/models/User.js)).
- Type aggregation rows with a cast on `aggregate(...).exec()` (see
  [insightsService.js](../backend/src/services/insightsService.js)).

## Tests

- **Shape.** HTTP-level through `app` with supertest, one in-memory MongoDB per file ([setup.js](../backend/tests/setup.js)).
- **Helpers.**
  - [helpers.js](../backend/tests/helpers.js): `seedOrg` (one user per role plus signed tokens), `makeRecord`, `bearer`.
  - [factories.js](../backend/tests/factories.js): real-password users, planted invite and reset tokens, `login`,
    `sessionCount`, refresh-cookie helpers.
- **Plant tokens, don't scrape them.** Invite and reset tokens are written with the factories (hash only, as the
  services store them). Never read them from `console.log`: that logging is a dev-only stand-in that goes away with email.
- **Silence token logs.** Tests that hit the invite or forgot-password endpoints mock `console.log`, so raw tokens
  never reach test output.
- **Test first.** For a fix, write the failing test and show it red before changing the code.
- **Mutation-check the important ones.** For a security- or tenancy-critical property, temporarily break the
  service code, confirm the specific test fails with a meaningful diff, then revert. (S1.1 and S1.1b each did this.)
- **Pinning suspect behaviour.** If a test must encode behaviour that looks wrong, mark it `// suspect: <why>` and list
  it in [known-issues.md](known-issues.md). Whoever fixes it flips the test.
- **Coverage.** `npm run test:coverage` (v8, over services, policies and utils; the empty `aiProxyService.js` is
  excluded until S2.2).
