# Known issues

Everything known to be wrong, missing or unverified that isn't a top-level gap in [CLAUDE.md](../CLAUDE.md) §9,
plus a record of what has been resolved. Newest resolutions first.

## Open findings (verified 2026-10-29)
- **List filters are silently dropped.**
  - `paginationQuery` in [validators.js](../backend/src/utils/validators.js) strips `status`, `entityType`,
    `entityId` and similar keys.
  - As a result, [NotesPanel.jsx](../frontend/src/features/notes/NotesPanel.jsx) shows **every note in the org**, and
    the status filter in [LeadsPage.jsx](../frontend/src/features/leads/LeadsPage.jsx) is ignored.
  - Affects leads, deals, contacts, companies, notes and notifications. Activities is fine: it has its own
    `activityListQuery`.
- **Pipeline stages are hardcoded on the frontend.** [PipelinePage.jsx](../frontend/src/features/deals/PipelinePage.jsx)
  and [DashboardPage.jsx](../frontend/src/features/dashboard/DashboardPage.jsx) use `PIPELINE_STAGE_DEFAULTS`, not
  the org's configured stages.
- **`stageKey` is only validated by `move-stage`.** `POST` and `PATCH` in
  [deals.routes.js](../backend/src/routes/deals.routes.js) accept any string, and
  [dealsService.js](../backend/src/services/dealsService.js) hardcodes the `won`/`lost` keys.
- **Dead config.** `JWT_REFRESH_SECRET`, `AI_SERVICE_URL` and `REFRESH_TOKEN_TTL` are required or documented but
  never read (see the env table in CLAUDE.md §6).
- **Typecheck isn't in a pre-commit hook yet.** That's deferred to S1.4 (husky + lint-staged); until then CI is the gate.
- **Referenced ids aren't checked against the org.** `companyId`, `contactIds`, team `memberIds` and note `entityId`
  can point at another tenant's documents, and `populate()` isn't org-filtered. (Owner fields are checked.)

## Open questions
- What exactly happens if a token lacked `orgId`? Mongoose likely casts it to `null` and matches nothing. (A token whose
  org *document* is gone gets a 404; see [missing-org.test.js](../backend/tests/missing-org.test.js).) Not tested.
- Does the [vercel.json](../vercel.json) rewrite really fail on `/api/v1/...`? Reasoned from path-to-regexp; not deployed.
- Is "Clarion" a deliberate rebrand, or should it be "Nimbus"?
- Docker Compose has never been run (Docker isn't installed on the dev machine used for the audits).

## Resolved
| Date | Issue | Fix |
|---|---|---|
| 2026-10-30 | An admin could still grant admin by inviting someone with `role: 'admin'` | `inviteMember` applies `assertCanAssign` (`17fe71b`) |
| 2026-10-30 | Settings → Members offered role/remove controls on your own row and, to admins, on peer admins (with "Admin" as an option) | UI mirror `canManageMember` / `manageableRoles` in [constants.js](../frontend/src/lib/constants.js) (`fbc81b1`) |
| 2026-10-30 | A refused (403) role change or removal failed silently in the UI | shared [ErrorAlert.jsx](../frontend/src/components/ErrorAlert.jsx) (`fbc81b1`) |
| 2026-10-30 | The frontend had no component tests, no e2e test and no typecheck | Vitest + Testing Library + MSW, Playwright, `tsc` opt-in (S1.3) |
| 2026-10-30 | Deleting an unknown team or email template id returned 200 (was a pinned suspect) | 404 in the same atomic write, `fix/s1.1b-suspects` (`06fd1c9`) |
| 2026-10-30 | An admin could demote or remove a peer admin, grant admin, or change or remove their own account (was a pinned suspect) | owner-only admin management, no self actions; [membership.js](../backend/src/policies/membership.js) (`faeabdc`) |
| 2026-10-30 | `activitiesService.list` had 40.9% line coverage | [activities-list.test.js](../backend/tests/activities-list.test.js); now 100% |
| 2026-10-29 | Auth, org admin and dashboards had no permanent tests (Known Gap #8) | [auth.test.js](../backend/tests/auth.test.js), [org-admin.test.js](../backend/tests/org-admin.test.js), [insights.test.js](../backend/tests/insights.test.js) |
| 2026-10-29 | Convert and move-stage crashed with a 500 when the org document was missing | 404, found by `tsc` strict null checks (`f609307`) |
| 2026-10-29 | Members could change anyone's records ("own records only" not enforced, Known Gap #1) | [ownership.js](../backend/src/policies/ownership.js) (`4a19175`) |
