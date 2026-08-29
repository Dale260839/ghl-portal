# What actually exists, 2026-08-29

**Verified, not remembered.** Every claim on this page was checked against the
repository or the live database on the date above. Where something is unproven it
says so.

Written because this project has repeatedly been described more optimistically
than it is — including by me. The corrections are recorded in the EODs rather
than smoothed over.

---

## 1. The one-paragraph version

Twenty-seven screens exist across three experiences and they work. The privacy
gate, the permission matrix and all eight workflows are built and tested — 419
tests. The contractor screens read **live production data** from BuildSuite.

What does not exist is **data for the operational half**: no field updates, no
milestones, no documents, no photos, because the nine tables that would hold them
have never been created. And upstream of all of it, **no deal has ever been
signed** — 0 of 182 — so the loop the product exists to run has never run once.

The build is not the blocker. That is the whole point of this page.

---

## 2. Screens — 27, all reachable

### Contractor (8)

| Route | State |
|---|---|
| `/dashboard` | Live projects; money tiles show `—` (BuildSuite has no contract value) |
| `/dashboard/pipeline` | **Live and complete.** The deal funnel — new this sprint |
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

### Entry points (2)

Sign-in (`/`) and the GoHighLevel landing (`/auth/ghl`). With the three groups
above that is **27 page routes**.

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
| Deal pipeline, stages, signature state | BuildSuite `deals` | **Live** — new this sprint |
| Field updates, milestones, tasks, documents, photos, messages | `hub_*` tables | **Do not exist** |
| Operational state after handoff | GoHighLevel custom objects | No object key; tier unconfirmed |

Fixtures still exist as a last-resort fallback when neither source is reachable,
and the banner calls that a misconfiguration rather than a mode. **There is no
longer any way to select sample data from the UI** — the demo toggle was removed
on 2026-08-28.

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
| **A signed deal** | 0 of 182. Nothing has completed the loop | Chris / ops |
| Field updates, milestones, documents, photos | `0001_hub_tables.sql` never run | Sing |
| The client portal showing anything | Same — every record lives in those tables | Sing |
| The handoff payload | `buildsuite_project_id` must be `BSP-YYYY-NNNNNN`; **no value in that format exists in BuildSuite** | Chris decides, Sing implements |
| `contract_amount` | BuildSuite has a budget *band*, not an amount | Sing |
| Reading operational state from GoHighLevel | No object key; tier unconfirmed | Pat |
| Live webhooks | The secret in `.env.local` is still the placeholder | Pat |
| Payments screen | Rail undecided — deliberately unbuilt | Chris |
| The signed-only filter being **on** | Would take Alliance from 9 projects to 1 | waits on a signature |

### The shared key, in detail

| Candidate | Format | Populated |
|---|---|---|
| `projects.id` | UUID | **101 / 101** — and what `deals.source_project_id` points at |
| `projects.project_code` | `BSA-002` | 48 / 101, unique where present |
| `projects.award_code` | — | 0 / 101 |
| ARCHITECTURE §5 requires | `BSP-YYYY-NNNNNN` | **0 / 101** |

D4 §6 names the format `APS-081`; BuildSuite holds `BSA-002`. Same shape,
different prefix — `project_code` is very likely what was meant. Not resolved
here: it is open decision C-3 and choosing is not ours.

---

## 7. The nine tables that do not exist

`0001_hub_tables.sql`, create-only — no `ALTER`, no `DROP`, nothing touching an
existing table. RLS deny-by-default, both tenancy keys on every row.

```
hub_daily_updates          hub_milestones      hub_update_acknowledgements
hub_documents              hub_photos          hub_update_comments
hub_messages               hub_schedule_items  hub_visibility_settings
```

**This single unrun file is why the field interface and the entire client portal
have no content.** It needs the service-role key, which is why it is Sing's.

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

## 9. Tests — 419, and what they are for

30 test files. They encode invariants rather than implementation: a test named
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
