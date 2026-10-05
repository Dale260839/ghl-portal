# Project Hub: Vercel Release Handover

Prepared for the engineer with access to the owning Vercel project.
Date: 5 October 2026, Asia/Manila.

## Objective

Release the pending Project Hub hardening without breaking the current GHL entry or exposing another contractor's data. Prepare and verify a protected feature deployment first. Production publication and cutover require separate owner approval.

**This is not a completed-production or unrestricted-client-launch signoff.** Most live evidence below was collected on 1-2 October. Local Git state was rechecked on 5 October; the current remote main and live deployment were not re-audited for this handover.

## Latest Verification: 5 October

- Feature snapshot `0ba666430c19cf1fb10bf47167fcfa49b8e01a26` is confirmed on GitHub.
- GitHub's Vercel deployment record `6853410144` reports `success`, environment `Preview`, and `production_environment: false` for that exact SHA.
- Preview: https://project-6ad29j8uv-allianceforcontractors-2450s-projects.vercel.app/
- Deployment details: https://vercel.com/allianceforcontractors-2450s-projects/project-hub/EqW8vLFa5SZcmLFj5WeR4Sfxjg6W
- Full local rerun on that snapshot: **1,377 web tests and 40 shared-contract tests passed, zero failures**.
- Opening the new preview's `/auth/crm` route redirects to Vercel login in the Alliance Work browser. The deployed application route and real GHL encrypted-context sign-in remain unverified behind protection.
- The new `/auth/crm` source is included in this successful preview snapshot. It has not been promoted to production by this work.
- Later handover-only commits do not change this tested application source; use the exact SHA above when assessing this deployment evidence.

Immediate next step for the engineer with access: open this exact preview, verify its source SHA and existing server configuration, and test the unpublished Marketplace draft against it. Reuse the existing secret and keep protection enabled.

## 1. Obtain the Actual Pending Source

| Item | Verified local state |
| --- | --- |
| Owning repository | https://github.com/home-afk/project-hub |
| Local remote | `company` |
| Mirror repository | https://github.com/Dale260839/ghl-portal; not the owning release repository |
| Feature branch | `codex/photo-flow-hardening` |
| Latest application change | `6a25873` (neutral CRM entry); follows hardening commit `9ba2173` |
| Locally cached company main | `4f0b573b9986aed64a45eb2afe7bfa5c241f0d92` |
| Branch contents | Pending hardening, the committed CRM entry/test, and this handover |
| WSL checkout | `/home/lenovo/worktrees/field-review-fixes` |
| Windows access to checkout | `\\wsl.localhost\Ubuntu-24.04\home\lenovo\worktrees\field-review-fixes` |

The delivery branch is `codex/photo-flow-hardening` in the owning repository. Fetch it and verify it contains application commit `6a25873` before preparing a release. The branch push is for review and may trigger a Vercel preview automatically; it is not a production cutover or a verified deployment.

These two additional files are now committed in `6a25873`:

- `apps/web/src/app/auth/crm/page.tsx`
- `apps/web/src/lib/auth/crm-entry.test.ts`

Review both. The first adds the neutral Marketplace entry URL by re-exporting the existing authentication page; it does not introduce a separate or weaker authentication flow.

To retrieve the handoff from an existing clone with this repository configured as `origin`:

```bash
git fetch origin codex/photo-flow-hardening
git switch --track origin/codex/photo-flow-hardening
```

If that local branch already exists, switch to it and use `git pull --ff-only origin codex/photo-flow-hardening`. Preserve local changes and resolve any divergence deliberately. If the owning repository is configured as `company`, substitute `company` for `origin`.

Branch: https://github.com/home-afk/project-hub/tree/codex/photo-flow-hardening
Repository handover: `docs/VERCEL-HANDOVER-2026-10-05.md`.

Fetch the latest owning main and compare it with this branch. Preserve any newer work and uncommitted changes. Do not reset the checkout or overwrite main. Pushing the owning main can trigger production deployment, so do not use that as the initial test step.

## 2. What Is Waiting to Be Released

| Area | Pending behavior |
| --- | --- |
| Contractor sign-in | Verifies encrypted Marketplace user context, checks agency/location binding, and uses embedded session cookies. Unsigned production location-only login is refused. |
| Operator access | Requires verified user identity and the configured operator restrictions; ordinary contractor access is not operator access. |
| Task photos | Validates photo references against the authorized task/project and links them to the new daily update. Partial linking is reported honestly. |
| Daily drafts | Recovers saved photo references and daily fields; isolates drafts by user/tenant; prevents an older success URL from erasing a newer draft. |
| Submission recovery | Waits for uploads/retries and preserves refused form contents. Successful submissions do not reuse old photo references. |
| Upload/file protection | Uses existing atomic upload-budget infrastructure and stricter membership, assignment, folder and file checks. |
| Mutation permissions | Rechecks current membership and role before saves, including revoked invited access and cross-project visibility changes. |
| Overview failures | Reports read outages rather than inventing zero projects, empty teams or missing contracts. Optional proposal outages do not unnecessarily crash the whole overview. |
| Health report | Performs fresh checks, redacts sensitive error details, and distinguishes configured settings from verified integrations. |
| Webhooks | Verifies native signatures and refuses to claim success for unexecuted workflows. **Durable workflow execution is still missing.** |
| Dependencies | Includes the tested Next.js v15/security dependency updates. |

Important webhook release impact: recognized but unexecuted workflows now return an unavailable response rather than a misleading success. Verify the actual sender's retry behavior. Do not assume a 503 guarantees redelivery or describe this as completed synchronization.

Upstream health reporting, month-grouped homeowner photos and project-specific crew messages were already merged into this local branch. They are not all new pending additions from this audit.

## 3. Secure GHL Entry: Required Before Cutover

The current working live menu opens a new tab at:

```text
https://project-hub-one-vert.vercel.app/auth/ghl?locationId={{location.id}}
```

That entry supplies a location claim, not verified user identity. **Deploying the hardened code over it before the replacement works can lock contractors out.**

### Existing Marketplace App

- Installed app: `ProjectHub`, ID `6ab2f6039bc6d1a874ed58a4`.
- Current installed version inspected: `2.0.0` Live, version ID `6ab35e0706be67b7fea5760b`.
- Prepared unpublished draft: version ID `6abf9d477562766fc94e2edf`.
- Draft Custom Page: ID `6abf9e6b97aeab94de462d4f`.
- Title: `Project Hub`; placement: sub-account left navigation only.
- Camera and microphone permissions are off. Do not enable them for this sign-in work.
- Do not confuse this installed app with the separate Agency-targeted draft app.

Saved draft URLs:

```text
Live:
https://project-hub-one-vert.vercel.app/auth/crm?locationId={{location.id}}

Testing:
https://project-ietndvlpe-allianceforcontractors-2450s-projects.vercel.app/auth/crm?locationId={{location.id}}
```

The neutral route avoids the existing white-label form's rejection of `/auth/ghl`. **The `/auth/crm` alias is committed on the feature branch. Neither saved URL is a verified working new sign-in endpoint.** Update the draft Testing URL to the actual approved feature deployment containing that route; do not blindly use the older preview hostname.

The app draft has not been published, and the live menu has not been replaced. Do not publish it merely because the form saves successfully.

### Existing Secret and Server Configuration

**Dale confirms an existing shared secret. Reuse it. Do not generate, rotate, reveal or send credentials through chat.** The UI's `Generate key` control was not sufficient evidence that the secret was missing; earlier audit text has been corrected.

Verify the intended server environment has:

- `GHL_APP_SHARED_SECRET`: the existing secret paired with the correct installed Marketplace app, server-only.
- `GHL_SSO_COMPANY_ID`: the correct agency binding.
- `GHL_PARENT_ORIGINS`: only the exact authorized HTTPS GHL/white-label parent origins.
- `SESSION_SECRET`: the existing server-only session configuration.
- `ADMIN_LOCATION_IDS` and, where required, `ADMIN_GHL_USER_IDS`: intended operator restrictions.

Verify configured names/presence without disclosing values. Presence alone is not proof of correct pairing; the real encrypted-context sign-in test must pass.

The last browser check could not access the owning Vercel settings: it returned 404 while logged in as `dale@alliance4contractors.com`. This is an access limitation, not evidence that server settings or the secret are absent. No local `.env`/`.env.local` was found in the feature checkout root or `apps/web`; that also does not establish what is configured in Vercel.

Owning project: https://vercel.com/allianceforcontractors-2450s-projects/project-hub

Keep deployment protection enabled. Do not solve test access by exposing the deployment publicly or restoring unsigned production authentication.

## 4. Database: Do Not Rerun Migrations

Prior live schema checks verified `0019`, `0020` and `0021` in **Project Hub**. The dashboard's migration-history label is not evidence that those changes are absent.

- Project Hub database: `nexpqqxarimqmntnvzff`.
- BuildSuite database: `bkngicyqgdwzmoeahqdi`, read-only forever.
- `hub_photos.update_id`, its foreign key/index, upload-budget infrastructure and photo-link guards were present.
- All 23 Hub tables had RLS enabled; media storage was private; browser TRUNCATE grants were removed.

No schema changes, migration reruns, grant changes, public storage, or production record repairs are authorized by this handover. Obtain specific owner approval for any named production write/test. Never grant `anon` access to fix a permission error.

## 5. Safe Release Sequence

1. Fetch the feature branch, including the committed CRM entry/test. Compare with latest company main and review the complete diff.
2. Run the checks below. Preserve new upstream work; do not copy isolated files over main without reviewing dependencies.
3. Inspect any protected preview triggered by the authorized feature-branch push. Verify its exact source commit, or prepare an approved feature deployment in the owning Vercel project. Do not push main yet.
4. Verify the existing secret pairing and other server settings. Any necessary credential entry/configuration changes need the authorized owner's involvement and approval.
5. Point the unpublished Marketplace draft Testing URL at the actual feature deployment and verify the embedded entry inside real GHL.
6. Complete the acceptance checks below. Record actual results and failures, not assumed success.
7. Present the tested commit and cutover plan to the owner for production approval. Explain the unsigned-menu and webhook behavior changes explicitly.
8. Only after approval, coordinate the application release, app-version publication and menu replacement. Smoke-test the production flow and record the deployed SHA.

Do not restore unsigned authentication as a rollback. If the verified entry fails, fail closed and fix the approved configuration. Leave the already-applied database protections in place.

## 6. Checks to Run

From the repository root, using the repository's Node/runtime setup:

```bash
npm test --workspace @buildsuite/web
npm test --workspace @buildsuite/contracts
npm run typecheck
npm run build --workspace @buildsuite/web
git diff --check
```

Use the existing isolated UI/iframe/stress harnesses with their documented fixture setup, not live credentials or production identities. These include `scripts/test-field-ui.mjs`, `scripts/test-ghl-iframe.mjs`, `scripts/test-overview-ui.mjs`, `scripts/test-pilot-pages.mjs` and `scripts/test-pilot-stress.mjs`.

Recorded checks:

- Full suite before the neutral alias: 1,374 web tests and 40 contract tests passed.
- After adding the alias: 21 focused authentication tests, web typecheck and optimized build passed.
- On 5 October, the full suite including the alias was rerun at `0ba6664`: 1,377 web tests and 40 contract tests passed with zero failures.
- Local fixture stress checks are not proof of live Vercel/database capacity.

## 7. Live Acceptance Checklist

- [ ] Contractor enters through the actual Marketplace iframe; no fabricated session or unsigned location-only bypass.
- [ ] Existing shared secret successfully verifies the real encrypted context for the intended agency/location.
- [ ] Sign-out, embedded cookies, account switching and current role behavior work.
- [ ] Forged/wrong-tenant context is refused; ordinary users cannot access operator health controls.
- [ ] An approved test crew submits a task update with a photo; saved `task_id` AND `update_id` are correct.
- [ ] PM sees the update and inline linked photo; only selected safe content/photos are published.
- [ ] Actual test homeowner sees published content and cannot see internal notes, costs or unapproved photos.
- [ ] Cross-project and revoked-member file requests produce genuine server denials. A browser block is not server-denial evidence.
- [ ] Failed/oversized/unsupported uploads, retries, draft reload and newer-draft preservation behave correctly.
- [ ] Overview error paths are checked against the approved release and relevant server logs.
- [ ] Notification record/review link is verified. Do not equate a GHL message record with external mailbox delivery.

Existing selected pilot identifiers, for inspection or a specifically approved test only:

- Project: `bbd77380-ebc6-417f-8aaf-0f03150198dc`, `Test Project`, `BSA-APS-001`.
- Tenant: `10e7fe30-eaa9-4fa1-91f5-2233af9d206f`.
- Task: `529a29af-79ea-4866-b812-75b52a41bb72`.
- Earlier photo: `4c2a16b5-2d22-4cda-ba51-bc1c84ee1e3c`.
- Earlier update: `bb085f47-197d-4352-a1b3-a1d13187a8db`.

The earlier live happy path showed released content to the test homeowner, but SQL found that photo's `update_id` was null. The pending task-action fix targets new submissions. Do not silently repair the old record or present the earlier happy path as proof that this fix is deployed.

## 8. Remaining Work Beyond This Deployment

- Intermittent Overview digest `3098744270`, observed at 01:49:12 UTC on 2 October: reload recovered; root cause remains unproven.
- Durable webhook ingestion/workflow execution and confirmed cross-system record mappings remain unfinished. GHL owns stage movement.
- Notifications remain best effort; a durable outbox/retry mechanism is not verified.
- Usable database AND media/PDF backup-and-restore evidence is still required.
- Online payments require a configured GHL gateway. Invoices remain draft-stage; do not send invoices or record payments for this release check.
- Native GHL staff revocation and full offline recovery of unsaved upload bytes are not established by the current local fixes.

## 9. Return These Results

Provide Dale with:

1. Final tested commit SHA and feature/production deployment URLs, clearly labelled.
2. Test/typecheck/build results and any failures.
3. Secure-entry and crew -> PM -> homeowner test evidence, including photo linkage and genuine authorization denials.
4. A list of configuration changes by NAME only, without secret values.
5. What was published/deployed versus left pending, plus remaining blockers and the approved rollback approach.

Supporting local evidence: `C:\Users\Lenovo\Desktop\chris\PROJECT-HUB-READINESS-AUDIT-2026-10-02`.
Repository context: `CLAUDE.md`, `docs/PILOT-HARDENING-2026-10-01.md` and `docs/PILOT-READINESS-2026-10-02.md`. Some historical subsections in those documents describe earlier commits; use this handover's current source identifiers and recheck live state rather than treating old snapshots as current.
