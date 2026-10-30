## What

<!-- One or two sentences: what this PR changes. -->

## Why

<!-- The problem it solves or the task it closes (link the issue). For a bug: what users saw and the root cause. -->

## How tested

<!-- Commands you ran and what they showed. New tests: say which, and that they failed before the fix. -->

- [ ] `npm run lint` and `npm run typecheck` (repo root)
- [ ] `npm test` in `backend/` and `frontend/`
- [ ] `npm run e2e` in `frontend/` (if it touches a user flow or the API contract)

## Screenshots

<!-- UI changes: before and after. Delete this section otherwise. -->

## Checklist

- [ ] One logical change; Conventional Commit messages
- [ ] No behaviour change hidden in a refactor (or it's called out above)
- [ ] Every query is scoped by `orgId`, and writes go through the ownership policy
- [ ] Request input is validated with Zod; no business logic in routes
- [ ] No secrets, tokens or personal data in code, logs or fixtures
- [ ] Docs updated where the change makes them wrong (CLAUDE.md, docs/, WORKLOG.md)
- [ ] Known bugs found along the way are in `docs/known-issues.md`, not fixed in passing
