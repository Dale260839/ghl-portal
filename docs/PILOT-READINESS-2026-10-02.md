# Project Hub readiness - 2 October 2026

## Decision

The selected live crew -> PM -> homeowner happy path was exercised successfully
on the approved Test Project. That is not an unrestricted client-launch signoff.
Local hardening is tested but is not deployed. No production release or schema
change was made in this audit. BuildSuite remained read-only throughout.

## Current Release

- Branch: `codex/photo-flow-hardening`, starting from `ec2e9b1`.
- Refreshed company main: `11b0fcefc3fe26c9634f268faf0458358d83661d`.
  Its only change from `ded0aed` adds `docs/HANDOFF.md`; no app code changed.
- GitHub's Vercel status for `11b0fce` is success:
  https://vercel.com/allianceforcontractors-2450s-projects/project-hub/6TAJgufBQYraVg1E2WHjA7xTACsp
- The feature preview still shows Request Sent for the authorized Dale Work
  account. Approval remains pending. Keep deployment protection enabled.
- The new handoff's migration/SSO checklist is historical, not proof of current
  absence. Live schema checks already verified 0019, 0020 and 0021. Do not
  rerun migrations. SSO is implemented in this branch, not proven live.

## Live Evidence

One synthetic photo and one crew update were submitted on the existing pilot
task. The PM reviewed the update and released only its test-safe summary and
the selected synthetic photo. Only Test Project's Show Photos and Show Daily
Updates were enabled; other settings remained unchanged. Normal contractor
entry and actual test-homeowner sign-in were used, not minted live sessions.

The actual homeowner saw the released photo (960 x 640) and the published
summary after reload. The older Approved Internally record/internal QA marker
was absent. These observations do not replace exhaustive response tests.

The exact 12:34 PM Manila test email was found independently in APS GHL
Conversations. Its review link targets `/dashboard/updates`. This proves a GHL
message record exists, not external inbox delivery. No inbox owner needs to
participate in further local debugging.

Live SQL confirmed a genuine gap: the pilot photo has the correct task_id but
its update_id is null. The local task-action fix below addresses that gap for
new submissions; existing production records were not silently repaired.

All 23 Hub tables had RLS enabled, the media bucket was private, no browser
TRUNCATE grants were found, and the service-only budget function and photo
guard were present. Detailed evidence is in the Desktop audit folder.

## Local Fixes

- Task submissions validate saved photo IDs against the authorized task/project
  before writes, ignore forged photo counts, and link photos to the new update.
  Link failure preserves the update and reports the partial result honestly.
- Both task and daily forms wait for uploads/retries. Rejected task submissions
  retain text, status and saved photo IDs despite React's native form reset.
  Successful submissions clear them so subsequent updates cannot reuse photos.
- Negative/non-finite crew counts and hours are rejected before database access;
  crew counts must also be integers. Zero and non-negative fractional hours work.
- A detected real data source without Hub storage refuses operational writes
  instead of reporting an in-memory fixture save. Explicit fixture mode remains
  available for isolated development; this is not a ban on all fixture reads.
- Hub requests now have a 15-second timeout. Network failure is reported without
  credential details. Writes are never automatically retried because an uncertain
  write may already have committed. This is not a confirmed fix for the live
  Overview digest below.
- BuildSuite exact counts now reject failed HTTP/transport reads and missing or
  invalid totals instead of silently showing zero projects. Confirmed exact
  zero remains zero. The new regressions failed on the former implementation.
- Overview reports an optional proposal/team read outage in that section, not
  as a missing contract or an empty access list. A proposal outage no longer
  takes down the rest of a successfully loaded overview. Mandatory ownership,
  project, overlay and operational reads still fail closed. Actual GHL money
  remains usable when only the optional BuildSuite proposal read fails.
- The actual webhook route now verifies current Ed25519, legacy RSA and explicit
  relay HMAC with separate header/key selection. Invalid or blank current
  signatures never downgrade to a valid legacy/relay signature. Native resource
  IDs are not treated as delivery IDs, and record creation dates no longer make
  new updates look stale. `OpportunityStageUpdate` routes to the stage planner.
- Webhook workflow execution is NOT implemented. The former route returned
  success after only logging recognized events. It now returns an explicit
  unavailable response without marking them processed; repeated attempts are
  not mistaken for completed work. Unknown authenticated event types remain
  deliberately ignored. This is truthful failure handling, not finished sync.
- The example environment now documents current/legacy webhook keys, the
  server-only SSO configuration and the required server credentials for both
  databases. No live keys, grants, secrets or menu links were changed.
- Daily draft recovery now includes saved photo IDs, crew/hours, weather and
  the decision checkbox. Upload completion persists references without needing
  another typing event, including a photo-only draft. Restoring photos locks
  the original project; detaching a reference preserves the text and never
  deletes a stored file. Legacy text-only drafts remain compatible. References
  use the authenticated file route, not cached storage paths or signed URLs.
- Daily update submission rechecks every saved reference against its tenant,
  project and unlinked status before any write, with at most eight concurrent
  reads. Missing/stale/wrong-project references fail closed. A later link
  failure preserves the update and displays a partial-filing warning; the PM
  message counts only confirmed links, not IDs supplied by the form.

Draft recovery is limited to this user's tab-session storage for one day.
Unsaved file bytes and in-flight upload queues are NOT restored after a reload,
and closing the tab can discard session storage. This is not full offline mode.
Operational submission/photo linking are still separate database writes;
bounded preflight reads do not make those writes transactional.

## Webhook Integration Gap

The route has neither a durable queue nor a configured workflow executor.
Do not enable business-effect ingestion until confirmed tenant/record mappings,
approved durable idempotency and real delivery tests exist. A console log or
GET registration response is not execution evidence. There is no migration
or invented record mapping in this patch.

Current signature and `OpportunityStageUpdate` payload behavior were checked
against the official [integration guide](https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide/)
and [event specification](https://marketplace.gohighlevel.com/docs/webhook/OpportunityStageUpdate/index.html).
The integration guide describes retries for non-2xx responses, but a separate
[retry support article](https://help.gohighlevel.com/support/solutions/articles/155000007071-automated-webhook-retries)
describes only 429 retries. These descriptions conflict. Do not claim that a
503 guarantees redelivery or recovery; verify the owning app's actual behavior.
The [logs dashboard](https://marketplace.gohighlevel.com/docs/webhook/WebhookLogsDashboard/)
supports inspecting deliveries and manually retrying failed latest deliveries.

## Verification

- Web: 1,297 tests passed, zero failures.
- Shared contracts: 40 tests passed, zero failures.
- Workspace typecheck and optimized production build passed.
- Production dependency audit: zero reported vulnerabilities.
- Real React uploader/task form harness passed automatic/manual retry, a
  12-photo queue, project locking, draft isolation/expiry, rejected-form
  preservation, successful reset and no reused photo IDs.
- Cross-origin GHL Connecting component harness passed handshake, untrusted
  origin refusal, malformed-context timeout and signed-query preservation.
  Its backend is mocked, not a live Marketplace sign-in.
- Local production-build stress: 880/880 expected responses, 16 workers,
  p95 126 ms. No live credentials or services were configured. This is not
  Vercel capacity, live Postgres contention or a real authentication test.
- Local 390 x 844 and 1440 x 900 pages rendered without horizontal overflow;
  sign-out, unsigned-login refusal, forged origin and revoked access passed.
- `scripts/test-overview-ui.mjs` renders actual Overview JSX with application
  CSS and mocked reads/editor at 390/1440 px. Both outage notices are visible
  without overflow; screenshots are local fixtures, not live product evidence.
- Reintroducing the former writer fallback made the new regression fail;
  the fixed source was restored and the full suite passed afterward.
- Database tests cover quota rollback and photo/update trigger boundaries using
  PGlite. Invoice tests use mocked GHL; no invoices were sent or paid.
- Thirteen new native-signature/actual-route tests use freshly generated local
  keys. They cover valid schemes, tampering, wrong algorithm, missing config,
  downgrade refusal (including a blank current header), successive resource
  updates, old record dates and repeated unexecuted workflow requests.
- Fourteen further draft-state/daily-action tests cover backward compatibility,
  expiry/corruption, safe reference shapes, meaningful default-value changes,
  duplicate/stale/wrong-project references, bounded reads and partial linking.
  The actual daily action is bundled with isolated read/write/notification
  adapters; this is not live database execution.
- The real React harness also proves saved photo/all-field restoration after
  reload, user isolation of references, photo-only recovery, detach without
  losing text, original-project locking and successful cleanup. The regression
  failed before the recovery change. Application CSS at 390/1440 px passes
  overflow/control-containment checks. Screenshot photo responses are mocked,
  not live file-authorization evidence.

## Remaining Release Gates

1. Authorized owning-account access to the feature release and logs. No need
   for Chris specifically, no shared password and no disabled protection.
   A fresh owning-project Logs check still returned Vercel 404 while Dale's
   Work account was signed in; the loading shell was not actual log access.
2. Configure and verify the replacement GHL Custom Page iframe and server-side
   SSO settings from the 1 October cutover document. An API token alone does
   not authenticate a contractor. Promoting before this test could lock out
   the existing unsigned-menu entry.
3. Investigate live Overview digest `3098744270` at 01:49:12 UTC on 2 October.
   Reload recovered and three bounded rechecks passed; root cause is unproven.
4. After an explicitly approved release, rerun the selected real-user photo
   flow and verify task photo update_id and inline review-queue rendering.
   Test PDF/upload-limit failure without opening browser database access.
5. Establish real cross-project and revoked-membership file-denial evidence.
   Chrome ERR_BLOCKED_BY_CLIENT on the earlier probe is not server 403/404 proof.
6. Verify usable backup/recovery. Implement and verify the missing durable
   webhook ingestion/workflow execution with confirmed record mappings and
   specific approval for any live changes. Verify real retry behavior and
   stage-sync configuration; GHL remains the owner of stage movement.
7. Notifications are best effort; a durable outbox/retry mechanism is not
   verified. A GHL message record must not be described as mailbox delivery.
8. Payments remain draft-only until a GHL gateway is configured. Do not collect
   test payments or send real invoices as part of readiness testing.

## Next

Keep the tested patch on the feature branch. Obtain only the owning release
access/configuration needed for the secure GHL entry, then seek specific
cutover approval. Do not merge to company main, push a deployment, change
production secrets, repair live data, or rerun migrations to make checks green.

Evidence folder: `C:\Users\Lenovo\Desktop\chris\PROJECT-HUB-READINESS-AUDIT-2026-10-02`.
