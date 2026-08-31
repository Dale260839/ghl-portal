# What actually exists, 2026-09-01

**Verified, not remembered.** Every claim on this page was checked against the
repository or the live database on the date above. Where something is unproven it
says so.

Written because this project has repeatedly been described more optimistically
than it is — including by me. The corrections are recorded in the EODs rather
than smoothed over.

---

## 1. The one-paragraph version

Thirty screens exist across three experiences and they work. The privacy gate,
the permission matrix and all eight workflows are built and tested — **502
tests**. The contractor screens read **live production data** from BuildSuite.

**Two things on this page changed on 2026-08-31 and both were corrections to
claims I had been repeating.**

**A job HAS been signed.** "0 of 182" was measured against
`deals.signature_signed_at`, a column BuildSuite does not populate. Signature
lives on `proposals`: four SIGNED rows with Adobe agreement ids and signed PDFs,
February 2026, all on one project. One job, once — not none, ever.

**The Hub now has its own database and writes to it.** A separate Supabase
project, so BuildSuite stays read-only forever. Sixteen tables, live. Contractors
can edit, archive and restore records, and invite their crew and clients.

What still does not exist is a second signed job, and a link from most sign-ins
to their contractor record.

---

## 2. Screens — 30, all reachable

### Contractor (11)

| Route | State |
|---|---|
| `/dashboard` | Live projects; money tiles show `—` (BuildSuite has no contract value) |
| `/dashboard/engagements` | **The book of work.** Live proposals, contractor-scoped, signed first |
| `/dashboard/pipeline` | The deal funnel — upstream of a job |
| `/dashboard/team` | Invite crew and clients, tick what they see, revoke |
| `/dashboard/archive` | Everything archived, restorable in one click |
| `/dashboard/projects` | Live projects, with signed / unsigned / no-deal badges |
| `/dashboard/projects/[id]` | Live project detail |
| `/dashboard/projects/[id]/visibility` | The per-project client-visibility switches |
| `/dashboard/buildsuite` | Live — raw incoming projects from BuildSuite |
| `/dashboard/issues` | Renders; empty (no store) |
| `/dashboard/updates` | Renders; **empty queue** (no store) |

### Field crew (4)

`/field` · `/field/tasks` · `/field/update` · `/field/messages`

Mobile-first, bottom navigation, safe-area padding, 56px tap targets. Built to
spec and tested. **Runs on no real data** — a field update has nowhere to go.

### Client portal (13)

`/portal` and: `timeline` · `schedule` · `updates` · `designs` · `budget` ·
`change-orders` · `documents` · `photos` · `messages` · `issues` · `payments` ·
`completion`

All thirteen render. **All thirteen show their empty state on real data**, because
every record they display lives in the uncreated tables. The navigation is real;
the content is not there yet.

### Entry points (3)

Sign-in (`/`), the GoHighLevel landing (`/auth/ghl`) and the invitation accept
page (`/invite/[token]`). With the three groups above that is **31 page routes**.

### API endpoints (3)

`/api/auth/ghl` · `/api/ghl/webhook` · `/auth/verify`

---

## 3. Data — what is real and what is absent

**The active source is BuildSuite's production Supabase.** Verified by running the
selector: `GHL_PROJECT_OBJECT_KEY` is empty so GoHighLevel is skipped,
`SUPABASE_URL` is set, so `activeSourceKind()` returns `buildsuite`.

| | Source | State |
|---|---|---|
| Projects, clients, addresses, dates | BuildSuite `projects` | **Live** |
| Live proposals: contractor, price, signature | BuildSuite `proposals` | **Live** — the book of work |
| Deal pipeline and stages | BuildSuite `deals` | Live, but see the caveat below |
| Contractor matching fan-out | BuildSuite `project_contractor_matches` | **Not read yet** — 272 rows, 47 projects, 23 contractors |
| Field updates, milestones, tasks, documents, photos, messages | `hub_*` tables | **Exist — the Hub's own database, 16 tables** |
| Record edits and archive | `hub_project_state` overlay | **Live.** BuildSuite is never written to |
| Team, invitations, permission ticks | `hub_memberships` / `_invitations` / `_grants` | **Live** |
| Operational state after handoff | GoHighLevel custom objects | No object key; tier unconfirmed |

Fixtures still exist as a last-resort fallback when neither source is reachable,
and the banner calls that a misconfiguration rather than a mode. **There is no
longer any way to select sample data from the UI** — the demo toggle was removed
on 2026-08-28.

### `deals` is not the matching table — corrected 2026-09-01

Confirmed by Sing: `deals` is the DealsEngine flow and has nothing to do with
matching. Matching writes to **`project_contractor_matches`** (272 rows), and a
contractor's proposal links to the same `project_id` and `contractor_id`.

That table's outcome columns are **null on all 272 rows** —
`contractor_accepted`, `client_selected`, `project_outcome` — and `projects.status`
has no `awarded` value. So the award step exists as a design and has not yet
written anything. Open question with Sing; do not build against
`client_selected` until it is answered.

### The funnel, measured

| Step | Deals | |
|---|---|---|
| Created | 182 | 100% |
| Linked to a project | 47 | 26% |
| Matched to a contractor | 5 | 3% |
| Sent to the CRM | 2 | 1% |
| Signature sent | 1 | 1% |
| **Signature signed** | **0** | **0%** |

Alliance tenant: 23 deals, 0 matched, 16 at `draft_ready`, 17 untouched for over
60 days, oldest 174 days.

### Reading discipline

Every staff-side read takes a `TenantScope` as a required first argument — there
is no unscoped overload, so forgetting to scope is a compile error. This was not
theoretical: in August the live database exposed 43 projects across five
contractors to any signed-in user.

The deal reader deliberately does **not** select `access_token`, `client_email`,
`client_phone`, `photo_urls`, `photo_analysis`, `metadata` or `signed_pdf_url`.
The publishable key permits all of them; the narrowest select is our half of that
exposure, and a test fails if any is added back.

**Caveat carried on the screen:** `deals.auth_profile_id` is populated on roughly
half the table, so a per-contractor count undercounts. The pipeline screen states
this itself rather than presenting the number as complete.

---

## 3b. The two databases

| | Database | Access |
|---|---|---|
| **BuildSuite** | `bkngicyqgdwzmoeahqdi` | **Read-only, forever.** No write method exists on its client |
| **Project Hub** | `nexpqqxarimqmntnvzff` | Read and write. Everything the Hub owns |

Two clients, deliberately not one. `BuildSuiteClient` can only issue GET, so
writing to someone else's production is structurally impossible rather than a
rule to remember. `HubClient` writes — and has **no delete method at all**,
because archive is `archived_at` plus who and why.

**RLS is currently OFF on the Hub database** (owner's decision, 2026-08-31, so
policy-writing did not block the build). That makes two guardrails load-bearing
and both are tested: the key is server-only and never `NEXT_PUBLIC_`, and
exactly one module reads it. `supabase/hub/0002_rls_development.sql` carries the
re-enable statements. **Write the policies before a real contractor's data
lands here.**

---

## 3c. Tenancy has two keys, and knowing which is which matters

| Reading | Filtered by |
|---|---|
| `projects`, `deals` | `auth_profile_id` |
| **`proposals`** | **`contractor_id`** — it has no `auth_profile_id` |
| `hub_*` | `contractor_id` |

That difference caused a real leak, found and fixed on 2026-08-31: passing a
scope to a `proposals` read only *asserted*, it did not filter, so every
contractor saw every other contractor's live work and prices.

The fix is `contractor-identity.ts` — resolve the session to a contractor via
`auth_profiles.contractor_id`, then an exact single email match. **When it
cannot be resolved the answer is nothing, not everything**, and an ambiguous
email resolves to nothing rather than guessing.

**Three links are tried in order**, and together they resolve **57 of 64**
contractor profiles: `auth_profiles.contractor_id` (1 of 110), then
`auth_profiles.contact_id` → `contractors.ghl_contact_id` (the workhorse — 472 of
483 contractors carry one), then email. They never disagree where more than one
applies. Ambiguity at any step falls through rather than guessing.

---

## 4. Rules — built and enforced

**The §9.1 privacy gate.** Four clauses, evaluated at the data layer rather than
in the UI. A client response assembled without it is a defect even if the screen
happens to hide the field. Client projections drop internal fields **by
construction** — a client session does not receive `margin: 0`, it receives no
margin property at all.

The invariant most likely to break quietly: **`Approved Internally` is not
approved for the client.** Only `Approved & Published` reaches one. Both read as
approval in English, which is exactly why it is tested from both directions.

**The permission matrix** — role × resource × action, closed by default (`?? false`).
Contractor has full CRUD; field crew writes updates, progresses **their own**
tasks and raises issues; client approves, comments and reports. `completeStage` is
granted to **nobody** — GoHighLevel owns stage movement. Permission and ownership
are separate checks and both must pass.

**The webhook receiver** refuses everything without a secret, in every
environment, with no development bypass. Signature over the raw body, absolute
timestamp window, replay set. Unmapped event types answer `200`, because a
webhook that 4xxs on unknown types gets switched off by whoever watches the
delivery log.

**All eight workflows** are pure planners returning `Effect[]`, executed
separately. An effect with no handler fails the build.

---

## 5. What was proven this sprint

**The whole chain rehearses end to end on synthetic data** — `npm run rehearse`.
Nine steps, 27 effects across three workflows, and it proves the negatives:
internally-approved stays hidden, a contact on another project is refused, and
turning the portal master switch off makes the chain report broken.

It is pure — no network, no clock, no writes — and there is deliberately no flag
that performs the handoff for real.

**What it cannot prove:** GoHighLevel's half. Steps 1–3 are asserted, not
executed. A step we do not perform never reports `ok`.

---

## 6. What does not work, and why

| | Reason | Owner |
|---|---|---|
| **A second signed job** | One exists, from February. The loop has run once | Chris / ops |
| Seven contractor profiles see no work | None of the three identity links resolves them | Sing, small and targeted |
| The one signed project's details | BuildSuite RLS hides that row from our key | Sing |
| The handoff payload | Key **answered**: it is `project_code` (BSA-NNN). Our pattern still expects `BSP-YYYY-NNNNNN` and needs changing | us, half a day |
| `contract_amount` | `total` is set on 8 of 46 proposals; `price` is free text | Sing |
| Reading operational state from GoHighLevel | No object key; tier unconfirmed | Pat |
| Live webhooks | The secret is still the placeholder | Pat |
| Invitation emails | No sender configured — the link is shown to the contractor to send | Chris to choose |
| Payments screen | Chris leans Stripe, pending whether GHL invoicing fires from a workflow — I am checking | us, then Chris |
| RLS on the Hub database | Deliberately off while the schema settles | us, before real data |

---

## 7. The Hub's sixteen tables — created 2026-08-31

`supabase/hub/0001_initial.sql`, create-only, run by hand in the SQL editor
because the app's publishable key cannot execute DDL (correctly — a running app
should never change its own schema).

```
hub_milestones      hub_schedule_items   hub_tasks
hub_daily_updates   hub_update_comments  hub_update_acknowledgements
hub_issues          hub_messages         hub_documents
hub_photos          hub_visibility_settings
hub_project_state   hub_activity
hub_memberships     hub_invitations      hub_grants
```

**`supabase/migrations/0001_hub_tables.sql` is SUPERSEDED and must not be run.**
It was written to add these inside BuildSuite's database and declares foreign
keys to `public.projects`, which does not exist in the Hub's project — it would
fail on the first table.

**No foreign keys to BuildSuite.** `project_id` is a plain indexed uuid.
Cross-database referential integrity is the application's job and it already
does it; the constraint was never enforceable across a network boundary.

---

## 8. Configuration

| Variable | State |
|---|---|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | set — this is what makes the app live |
| `GHL_API_BASE_URL`, `GHL_PRIVATE_INTEGRATION_TOKEN`, `GHL_LOCATION_ID` | set |
| `SESSION_SECRET`, `NEXT_PUBLIC_APP_URL` | set |
| `GHL_PROJECT_OBJECT_KEY` | **empty** — blocks all GoHighLevel reads |
| `GHL_WEBHOOK_SECRET` | **placeholder, not a real secret** |
| `CRON_SECRET` | empty |
| `ENABLE_SIGNED_ONLY_FILTER` | unset → **off**, deliberately |
| `DISABLE_VIEW_AS` | unset → view-as available |

---

## 9. Tests — 502, and what they are for

35 test files. They encode invariants rather than implementation: a test named
`§3.2 …` asserts an architectural MUST, and if it fails the code is wrong, not
the test.

Some read the source and assert properties of the codebase itself — that every
mutating server action calls `assertCan` before it writes, that no lookup is keyed
on a name, that every test file is actually matched by a test glob. Those
guardrails fired three times this week, each catching something real:

- 18 handoff tests that would have looked like coverage and never run
- six HUD steps pointing at screen elements that no longer exist
- a hand-maintained list inside the script whose purpose is to prevent
  hand-maintained lists

Where a guardrail matters, it has been **mutation-tested** — deliberately broken
to confirm it fails.

---

## 10. Two deployments

| Remote | Purpose |
|---|---|
| `origin` → `Dale260839/ghl-portal` | development |
| `company` → `home-afk/project-hub` | **what Vercel deploys** |

Both currently at the same commit. Live at
https://project-hub-one-vert.vercel.app

---

## 11. If you read one thing

Everything downstream of a signature is built and tested. The screens exist, the
rules are enforced, the workflows plan correctly, and the chain completes when
rehearsed.

**One deal reaching signature unblocks more than every technical item combined**,
and it is not a build task. The second most valuable thing is one migration.

Both are on other people's desks, and each has a one-page brief in `docs/asks/`.
