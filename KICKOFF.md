# BuildSuite™ Three-Experience Platform — 3-Week Kickoff Plan

> **Governing doc:** `ARCHITECTURE.md` v1.0 (2026-07-30). That file wins on every
> conflict. This file only sequences *when* things get built and *who* builds them.
> **Start:** 2026-07-31 · **Target:** 2026-08-21

---

## 0. Scope reality check (read first)

This project is roughly 60% GoHighLevel **configuration** and 40% **code**. They
are tracked separately on every line below:

- **[GHL]** — done inside the GHL UI (custom objects, pipeline, workflow builder,
  snapshots, portal settings). Humans only; not automatable by an agent.
- **[CODE]** — lives in this repo. Sync-back job, handoff contract, the §9.1 gate
  and §9.3 deny-list enforced at the data layer, and (pending decision F1) the
  front-end surfaces.

The critical-path risk is not code volume. It is **three external dependencies**:
the plan-tier confirmation (D4), Sing's Send-to-CRM extension (Phase 2), and
whether AI Studio can bind live per-client data (Test B). All three are pulled
into Week 1 Day 1–2 deliberately.

---

## 1. Three-week shape

| Week | Phases | Ships |
|---|---|---|
| **1** | 0 → 1 → 2 | Gates pass · `Project` object + pipeline live · a signed proposal auto-creates a synced GHL project |
| **2** | 3 → 4 | Contractor Dashboard on real data · Client Portal authenticated + filtered |
| **3** | 5 → 6 | Field Interface + review/publish loop · snapshot package validated in Alliance Pro Services |

**Demoable slice completes end of Week 2**: sign a proposal in BuildSuite → project
appears → stage moves → client sees progress. Week 3 is the field loop + distribution.

---

## Week 1 — Foundation & the data chain

### Day 1 (Mon) — Phase 0 gates. **Nothing else starts until both pass.**

| # | Task | Owner | Type |
|---|---|---|---|
| 0.1 | Confirm on the *contractor sub-account tier*: Custom Objects available, native Client Portal available, snapshots carry objects/fields/associations | Chris + Pat | [GHL] |
| 0.2 | Master build sub-account `BuildSuite™ Development / Template` created, clean | Chris + Pat | [GHL] |
| 0.3 | Throwaway test contractor sub-account provisioned | Chris + Pat | [GHL] |
| 0.4 | Integration token issued for build sub-account | Sing | [GHL] |
| 0.5 | **Test A** — snapshot transfer (~10 min, ARCHITECTURE §15) | Chris + Pat | [GHL] |
| 0.6 | **Test B** — AI Studio live data, Progress 62 → 70 (~1 hr, §15) | Chris + Pat | [GHL] |
| 0.7 | ✅ **Done.** Repo scaffold + `packages/contracts`: `BSP-YYYY-NNNNNN` validator, §9.3 deny-list, §9.1 gate predicate — all pure, 34 tests green | Claude | [CODE] |

**Runbook for 0.1–0.6: [docs/PHASE-0.md](docs/PHASE-0.md)** — step by step, with
the exact fixture values and a results table to fill in.

**Gate:** both tests green → Day 2 proceeds.
- Test A fails → Phase 6 becomes a per-account setup script; I write that script instead of a snapshot checklist. Adds ~1 day to Week 3.
- Test B fails → **stop**. Every client-facing screen in Weeks 2–3 depends on it.
  Re-plan the live-data layer before building any UI. This is the schedule-killer.

### Day 2–3 (Tue–Wed) — Phase 1: shared data foundation

- [GHL] `Project` custom object with the **demoable-core field set only** — identity,
  status, dates, financials, visibility flags (§6.1). Not all nine objects.
- [GHL] `BuildSuite™ Project Lifecycle` pipeline — 19 sequential stages + On Hold /
  Canceled, verbatim names (§7). Pipeline sits on the **Opportunity**.
- [GHL] Associations: Contact → Project, Project → Opportunity / Company / team roles.
  **Modeled as one-contact-to-many-projects from the start** (§1.4) — retrofitting
  this later touches every query.
- [CODE] ✅ **Done.** Typed schema mirror of §6.1 (`project-schema.ts`) and §6.4 +
  the §10 state machine (`daily-update.ts`), so field names can't drift between the
  GHL object builder, the workflows, and the screens. `demoableCoreFields()` is the
  build list for the [GHL] item above — ten fields, no more.

### Day 3–5 (Wed–Fri) — Phase 2: workflows & the handoff

- [CODE/Sing] **Send-to-CRM extension** — stamps `buildsuite_project_id`,
  `project_name`, `project_address`, `contract_amount`, `client{}` onto the Contact
  in the same call (§8.2). ~1 day, Sing owns it. **Longest external lead time —
  kicked off Day 1, not Day 3.**
- [GHL] **WF1 New Project Setup** — Opportunity → `Estimate Approved` creates the
  Project, associates Contact + Opportunity, assigns PM, seeds default
  milestones/tasks, Progress = 10%, prepares portal access. Owner: Dale.
- [GHL] **WF2 Project Stage Sync** — Opportunity stage change → update Project Stage,
  Progress, Current/Next Milestone, notify. Owner: Dale.
- [CODE] **Hourly stage sync-back** — scheduled job reads each project's pipeline
  stage by `buildsuite_project_id`, updates BuildSuite's My Projects view.
  Read-only against GHL; creates no GHL records (§8.3). Includes retry/backoff and
  a run log keyed by project ID.

**Week 1 exit criteria:** approve an estimate in BuildSuite → a `Project` record
exists in GHL with the right shared ID → move the opportunity stage → the Project
mirrors it → the hourly job reflects it back in BuildSuite.

---

## Week 2 — The two client-facing surfaces

### Day 6–8 (Mon–Wed) — Phase 3: Contractor Dashboard on real data

Six screens, **and only these six** (§12.1): Portfolio Overview · Projects List ·
Project Overview · Project Timeline · Daily Update Review · Client Visibility Settings.

- Wire Portfolio Overview + Projects List to real `Project` records first; layer the
  rest on top.
- Every contractor-created item that can surface in the portal carries the full
  control set: `Client Visible` · `Client Summary` · `Internal Notes` ·
  `Publish Date` · `Notify Client` · `Client Action Required`.
- Daily Update Review ships all seven actions verbatim: Approve and Publish ·
  Approve Internally · Edit Client Summary · Return for Revision · Create Issue ·
  Create Task · Notify Client.
- **Deferred by design:** accounting, warranty, vendor, reporting. Do not start them.

### Day 9–10 (Thu–Fri) — Phase 4: Client Portal connected

- [GHL] Enable native Client Portal. Contracts, estimates, invoices, receipts,
  payments, document uploads route through it — `Pay Now` hits native GHL invoices.
- [CODE] Connect the AI Studio prototype as the richer tracking layer: real GHL auth,
  live project data, filtering by signed-in contact, project switcher for
  multi-project clients, wired approve/message buttons.
- [CODE] **The gate, at the data layer** (§9.1). Client Visible = Yes AND Manager
  Approval = Approved AND Client Portal Enabled AND requesting contact is associated
  with the project. UI is never the only enforcement.
- [CODE] **Deny-list serializer** (§9.3). Internal Notes, Vendor Cost, Internal Labor
  Cost, Original Estimate, Markup, Margin, Profit, Contingency, Private Team Messages,
  Internal Risk Assessment, Delay Reason, Internal Priority — stripped in the
  serializer, with a test that fails if a new internal field is added without a rule.
- [CODE] Auth tiering (§9.2): email + Project ID locates and reads approved summaries
  only. Approvals, payments, contracts, private messages, warranty → portal login.

**Week 2 exit criteria = the demo.** Full chain, signed proposal to client-visible
progress, with a red-team pass: log in as Client A, confirm zero visibility into
Client B's project and zero internal fields in any response payload.

---

## Week 3 — Field loop & distribution

### Day 11–13 (Mon–Wed) — Phase 5: Field Interface + publishing state machine

- Mobile-first, minimal typing, large tap targets, bottom nav (§12.2).
- Minimal build: assigned projects · today's tasks · start/complete task · daily
  update form · photo upload · report issue · submit to PM.
- The daily update form ends in **two separate text areas** — `Internal Field Notes`
  and `Suggested Client Progress Summary`. Only the second is ever a publish
  candidate. `Save Draft` and `Submit to Project Manager`; no auto-publish path exists.
- [GHL] **WF3 Field Update Submitted** — sets Manager Approval = Pending, notifies PM,
  adds to review queue, creates an Issue on blocker, **does not notify the client**.
- [GHL] **WF4 Field Update Approved** — on `Approved & Published`: set Client Visible =
  Yes, publish Client Summary, update Project.Last Updated Date, notify client,
  add to portal feed.
- Field users see **only assigned projects**, bound by §9.4 (no profit, markups,
  internal financials, client payment details, private messages, employee records).

### Day 14–15 (Thu–Fri, 2026-08-20/21) — remaining V1 + Phase 6 packaging

Schedule · tasks · documents · client messages · issues · basic financial summary.
**Explicitly deferred to V2/V3:** time tracking, materials inventory, delivery
management, offline mode, subcontractor access, detailed budgets, change-order and
selection automation, design versioning.

> **Calendar honesty:** Day 15 is 2026-08-21, the last day of the three weeks.
> Building the snapshot package fits inside Day 15. **Validating it in Alliance Pro
> Services does not** — that is a live sub-account with a real deployment risk, and
> it is the one item that spills to the following Mon–Tue (Aug 24–25). Plan for it
> rather than discovering it on the 21st. If the three-week boundary is hard,
> Phase 6 ships as a validated package in the *test* sub-account and Alliance goes
> in week 4.

### Phase 6 — deployment package

- Package the snapshot: custom objects · fields · pipeline · workflows · forms ·
  calendars · document & contract templates · email & SMS templates · AI Studio
  experiences · portal settings · contractor roles · field roles · notification
  logic · sample project · test contacts.
- Validate the package in **Alliance Pro Services** (first live implementation).
- Distribute per contractor sub-account, gated per the D1 packaging decision.

---

## 1b. Revised remaining plan (from 2026-08-05)

The original week-by-week shape assumed AI Studio and GHL-native workflows.
D-001 and D-002 changed both, and the demoable UI landed in week 1 — so the
remaining work re-phases around **what each credential unlocks** rather than
around calendar weeks.

| Phase | Days | Ships | Gated on |
|---|---|---|---|
| **A — Live data** | Aug 5–7 | `GhlDataSource` replaces fixtures behind the existing seam. Every screen already built runs on real GHL records. Read-only. | GHL keys (§8 group 1) + Phase 0 results |
| **B — The chain** | Aug 10–14 | WF1 + WF2 as application code · Send-to-CRM handoff (Sing) · hourly stage sync-back. A signed proposal becomes a live project that stays in sync. | Group 1 + 3, `GHL_WEBHOOK_SECRET` |
| **C — Real auth + close-out** | Aug 17–21 | GHL portal auth replaces the demo session · field loop end-to-end · V1 remainder · deploy to a real URL | Group 4 + how contact identity resolves server-side (Phase 0 Test B) |

**Phase A is the whole ballgame.** Once the screens run on live records, every
subsequent phase is additive rather than speculative. It is also the cheapest
phase, because the seam already exists — `ProjectDataSource` in
`apps/web/src/lib/data/source.ts` is one interface with one implementation to
add. No screen changes.

**What stays out of scope for the window:** design versioning, material
selections, digital approvals, detailed budgets, advanced scheduling, field time
tracking (V2 per §14), and the whole V3 list.

---

## 2. Standing invariants — violating one is a defect regardless of tests

1. One record, three views. Visibility is per-item, never per-system.
2. Field submits → PM reviews & edits → PM publishes. Never auto-publish.
3. Client sees a record only when Client Visible = Yes **and** Manager Approval =
   Approved.
4. Email + Project ID is lookup convenience only. It gates nothing that matters.
5. §9.3 internal fields never serialize into a client response.
6. `BuildSuite Project ID` is the only join key. Never match on name, address,
   email, or opportunity title.
7. Ship slices — prove the chain before widening scope.
8. Portals never call BuildSuite directly. The handoff is the only bridge; the
   hourly stage sync-back is the only backward channel.

---

## 3. Open decisions — blocking, not assumable (ARCHITECTURE §16)

| # | Decision | Blocks | Needed by |
|---|---|---|---|
| D4 | Custom Objects + native Client Portal available on the contractor sub-account tier | **Everything** | Day 1, before Test A |
| D3 | Dedicated build sub-account + integration token | Clean snapshot source | Day 1 |
| D2 | BuildSuite Project ID confirmed as master key | Schema everywhere | Day 2 |
| D1 | Client Portal: paid add-on vs bundled in higher tiers | Per-sub-account gating | Day 9 (Phase 4) |

Reaching dependent code with one of these unresolved → stop and ask. Do not default.

---

## 4. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Test B fails (AI Studio can't bind live per-client data) | Kills Weeks 2–3 as planned | Tested Day 1 for ~1hr of cost; fallback is a custom front-end against the GHL API, which re-prices the schedule |
| Test A fails (snapshots drop custom objects) | Phase 6 distribution model breaks | Fallback: per-account setup script driven by the GHL API. ~1 extra day |
| Send-to-CRM extension slips | Week 1 exit criteria slip; Phase 3 can still proceed on manually-seeded records | Kicked off Day 1; manual fixture path unblocks downstream work |
| Contact↔Project modeled as 1:1 | Rework across schema, queries, and every UI surface | Enforced in Phase 1 review; multi-project client is a Phase 4 test case, not an afterthought |
| Nine-object model built up front | Burns Week 1 on unused surface area | Only demoable-core fields in Phase 1; supporting objects added by the phase that consumes them |
| Three weeks is aggressive vs. the doc's own 3–5 week V1 estimate | Week 3 scope | Weeks 1–2 (demoable slice) are the committed scope; Week 3 V1 remainder and Phase 6 are the compressible surface |

---

## 5. What I need to keep building

Nothing below blocks Day 1 — `packages/contracts` is already done and green. These
are ordered by when they start costing us.

### Blocking, in date order

| # | What | Blocks | Needed by |
|---|---|---|---|
| ~~F1~~ | ✅ **RESOLVED 2026-07-31 — we build the front-end in this repo.** AI Studio is out; its limitations don't carry the three experiences. See §6 for what this changes. | — | — |
| ~~F2~~ | ✅ **RESOLVED 2026-07-31 — workflows are application code in this repo.** Not GHL-native, not n8n. See D-002. | — | — |
| ~~F3~~ | ✅ **RESOLVED 2026-07-31 — direct GHL API access approved, with guardrails.** See D-003. Still need the token + base URL to actually run anything. | — | — |
| ~~F4~~ | ✅ **RESOLVED 2026-07-31 — sync-back writes through Sing's existing BuildSuite API.** See D-004. Need the endpoint list. | — | — |
| **D4 → D1** | The four architecture decisions in §3 above, on the dates listed there. | See §3 | Day 1 / Day 2 / Day 9 |

### Useful, not blocking

- **Read access to the AI Studio client-portal prototype** — Sing's review says it's
  already close to target. I'd rather wire the real thing than rebuild it.
- **One real handoff payload** from Sing's extended Send-to-CRM, captured verbatim.
  `handoff.ts` validates against §8.2 as written; a real sample is what proves the
  contract matches reality. (Sing has offered same-day turnaround on exactly this
  kind of ask.)
- **Whether BuildSuite's own repo is on this machine** or I'm working purely against
  the GHL side. Changes how much of the handoff I can verify end-to-end.
- **Confirmation on the stage count.** ARCHITECTURE §7 lists **19** sequential
  stages; the kickoff PDF says 20. §0 says the architecture wins, so `enums.ts` and
  its tests encode 19 — but whoever builds the pipeline in GHL should know the two
  docs disagree before they start counting.
- **Is the financial gate AND or OR?** §9.3 writes it as "`Show Budget to Client` /
  `Show Detailed Pricing`" without saying whether the slash means either switch
  grants the fields, or both are required. `project-schema.ts` implements OR and
  says so in a comment. If it should be AND, it's a one-word change plus whatever
  the tests then flag.
- **Which switch does `Show Schedule to Client` actually gate?** The architecture
  names the switch (§6.1) but never maps it to fields, so the date fields are
  currently ungated beyond the §9.1 gate itself. Probably wants to cover the Dates
  group — but that's a guess, so it isn't encoded.

### Surfaced by building WF1 / WF2 — three gaps in §11

All three are isolated in `apps/web/src/lib/workflows/defaults.ts`, marked
PROVISIONAL, and read from tables rather than hard-coded — so each is a one-table
edit once Chris confirms. None of them blocked the build.

| # | Gap | What's there now |
|---|---|---|
| **W1** | §11 WF2 says "update Progress Percentage" on stage change but gives **no stage → progress mapping**. | A straight-line table anchored on the two figures §11 does state: 10% at creation (WF1) and 100% at Completed (WF8). |
| **W2** | §11 WF1 says "create default milestones" and "create default tasks" — **neither list is given anywhere**. | Seven generic milestones and two tasks. Kept deliberately thin: a wrong default task on every new project is noise a PM clears by hand. |
| **W3** | §11 WF2 says notify the client "**only when appropriate**" — appropriate is never defined. | Six stages, biased toward silence. Over-notifying gets a portal muted, after which the notifications that matter are missed too. |

One behaviour worth confirming rather than assuming: **On Hold and Canceled do
not move the progress bar.** A project paused at 65% has not regressed to 0, and
showing that to a client would be alarming and wrong — so the planner skips the
progress effect entirely for the two non-linear stages.

### What I'm doing next

F1 is resolved (§6). The front-end shell, the server-side data layer, and the
gate enforcement are all buildable now behind a GHL client interface, with F3/F4
filling in the transport later. F2 still blocks workflow work.

---

## 6. Decision log

### D-001 · Front-end is built in this repo, not GHL AI Studio
**Decided:** 2026-07-31 · **Resolves:** F1

AI Studio's limitations don't carry three permission-controlled experiences. All
three surfaces — Contractor Dashboard, Field Interface, Client Portal — are built
here as a real application against the GHL API.

**This does not change §12.3's native-vs-custom split.** Contracts, estimates,
invoices, receipts, payments, and document uploads still route through GHL's
**native** Client Portal. We are replacing the AI Studio *tracking* layer, not
the native financial/document layer. `Pay Now` still hits native GHL invoices.

**What it changes:**

| | |
|---|---|
| **Week 2 effort** | ~3 days → ~8. This is the compression the risk register warned about; Week 3's V1 remainder absorbs it. |
| **Now ours to build** | Auth + session handling, a GHL API client with retry/backoff, server-side rendering of every client-facing read, hosting + deploy, and the project switcher. None of these existed as line items when AI Studio was assumed. |
| **Now easier** | §9.1 gate and §9.3 deny-list enforcement. They stop being "hope the AI Studio binding respects them" and become server-side code with tests — which is what §13 required in the first place. |
| **Phase 6 impact** | The snapshot no longer carries the front-end. It ships custom objects, fields, pipeline, workflows, and portal settings; the app is deployed separately and pointed at each sub-account. **This is a real change to the distribution model** and needs saying out loud to Chris + Pat before Phase 6. |

**Kills Phase 0 Test B as written.** Test B exists to prove AI Studio can bind
live per-client data. We aren't using AI Studio, so that test proves nothing.
Replaced — see `docs/PHASE-0.md` §3.

---

### D-002 · Workflows are application code in this repo
**Decided:** 2026-07-31 · **Resolves:** F2

WF1–WF8 are built here, not as GHL-native workflows and not in n8n. GHL,
BuildSuite, and Supabase are treated as integrated systems over a shared
database rather than as a chain of hand-offs between separate automation tools.

**⚠ This departs from ARCHITECTURE.md and the doc needs amending (§0).** Three
specific conflicts, none of them fatal, all of them worth Chris's and Sing's
sign-off before Phase 2:

1. **§11 defines WF1–WF8 as GHL workflows** triggered by GHL events. As code,
   the triggers become webhooks or polling — GHL still fires the event, but the
   logic and the retry semantics move here. Behaviour must stay identical to
   §11; that section is still the specification even though it is no longer the
   implementation.
2. **§1.2 says GHL owns all operational records after handoff.** That still
   holds — we *write through* GHL rather than owning a parallel copy. Anything
   that would create a second source of truth for milestones, tasks, updates,
   change orders, or invoices is out of scope for this decision.
3. **§1.1 says the portals MUST NOT call BuildSuite directly.** A shared
   database materially weakens that boundary. It stays enforced as a rule: the
   client-facing surfaces read the project record, never BuildSuite's estimating
   internals. The §9.3 deny-list becomes *more* important here, not less,
   because a shared DB puts internal cost fields within reach of a careless
   query.

**Phase 6 impact, compounding D-001.** Workflows now leave the snapshot too.
What ships in the snapshot: custom objects, fields, pipeline, forms, templates,
roles, portal settings. What deploys separately and is pointed at each
sub-account: the app, the workflows, the sync-back job. **The "build once,
snapshot everywhere" multiplier is materially smaller than the plan assumed.**
Chris and Pat need to hear this before Phase 6, not during it.

---

### D-003 · Direct GHL API access approved — with standing guardrails
**Decided:** 2026-07-31 · **Resolves:** F3

Hitting the GHL API directly is approved. Two standing rules, which apply to
every session and every agent working in this repo:

> **1. Ask before acting.** Any write, any state change, any run against a live
> system gets confirmed first. Reads are fine.
>
> **2. Supabase is PRODUCTION. Never change any table.** No schema changes, no
> migrations, no `ALTER`, no `DROP`, no destructive `UPDATE`/`DELETE`. Treat it
> as read-only unless explicitly told otherwise for a specific, named write.

Mirrored into `CLAUDE.md` so it survives context loss.

**Still needed to run anything:** the integration token and API base URL for the
build sub-account, plus Supabase connection details (read credentials).

---

### D-004 · Sync-back writes through Sing's existing BuildSuite API
**Decided:** 2026-07-31 · **Resolves:** F4
**⚠️ INVALIDATED 2026-08-06 — see D-005.**

Sing already exposes a BuildSuite API; the hourly stage sync-back (§8.3) uses
those endpoints rather than a direct database write. Correct call — it keeps the
§8.3 "read-only against GHL, no direct writes into another system's storage"
posture intact and leaves BuildSuite owning its own invariants.

**Still needed:** the endpoint list and auth method. Specifically — which
endpoint accepts a stage update keyed by `buildsuite_project_id`, what it
returns, and whether it is idempotent under retry. The sync-back runs hourly
across every project, so a non-idempotent endpoint changes the job's design.

---

### D-005 · The sync-back is BLOCKED on a design decision, not a key
**Found:** 2026-08-06, from Sing's `BuildSuite_API_Integration_Docs.md`

Reading the actual API reference invalidated the assumptions D-004 rested on.
**Do not build the sync-back job until this is resolved.**

**1. There is no machine authentication.** Every authenticated endpoint requires
an HTTP-only `bs_session` JWT cookie, issued *only* through the GoHighLevel login
flow. No API key, no bearer token, no service account, no client-credentials
flow. `BUILDSUITE_API_KEY` does not exist. A server-to-server hourly job — which
is exactly what §8.3 specifies — **cannot call this API today.**

Sing gives two options, and they change the shape of everything downstream:

| Option | Cost | Consequence |
|---|---|---|
| **A · Proxy the user's session.** Our portal runs on a `.buildsuite.ai` subdomain, the cookie rides along, we call the API as that user. | No backend work for Sing | Kills the *scheduled* sync-back — it only runs while a user is browsing. Also constrains our hosting: CORS is restricted to `buildsuite.ai` origins. |
| **B · A scoped service token.** Sing adds a header token with an explicit endpoint allowlist. | ~0.5–1 day on his side | Preserves §8.3 as designed. **Recommended.** He asks for the exact endpoint list, which is in `What_We_Need_From_Sing.md`. |

**2. The write endpoint we need is documented as broken.**
`PUT /projects/{project_id}` compares a GHL contact id against a UUID column and
returns **403 for every non-admin caller**. `POST /projects/{project_id}/delete`
has the same defect. The closest working candidate is
`PATCH /projects/my-projects/{project_id}/status` — contractor-only, with
state-machine validation — but it is keyed on `projects.id` (a UUID).

**3. `buildsuite_project_id` does not appear anywhere in the API.** There are four
non-interchangeable id spaces — `contractors.id`, the GHL contact id,
`auth_profiles.id`, and `projects.id`/`deals.id` — and none of them is
`BSP-YYYY-NNNNNN`. **Our entire join-key model (§5, §3.6) assumes BuildSuite owns
that ID natively.** Either it is minted at handoff and stored somewhere this doc
doesn't cover, or the shared-key premise needs revisiting. This is the single most
important question outstanding, above the credentials.

**4. Two traps worth recording** even though they don't affect us yet:
`GET /projects/` **has a write side effect** — it increments plan usage on every
call, so polling it burns a contractor's quota. And deal/proposal status values
serialize **UPPERCASE** (`PROCESSING`, `COMPLETED`), so branching on lowercase
never matches.

---

### D-008 · The Project Hub is a distinct system, with its own two keys
**Decided:** 2026-08-06

The Project Hub is a **distinct project-management system**, not a feature of
BuildSuite. It receives two credentials of its own:

1. **A GHL private integration key** — the same kind BuildSuite uses. This
   unblocks live project data and closes F3.
2. **The API key for the backend BuildSuite uses.** ⚠️ *Pending confirmation of
   which backend this means — see the open question below.*

**This makes BuildSuite's cookie-only API a non-problem.** D-005 was blocked
because BuildSuite's FastAPI has no machine authentication. If the Hub reads
BuildSuite's data from the shared backend directly, it never calls that API and
the blocker is routed around rather than solved. **The Supabase guardrail applies
in full: read-only, never alter a table (D-003).**

**⚠️ Open — and it changes the auth design, so resolve before building:**

D-006 said the Hub authenticates via `bs_session`, which only works if the Hub is
served from a `.buildsuite.ai` subdomain — that is the cookie's domain. But a
**distinct** system implies its own host, and ARCHITECTURE §2 routes the
contractor surfaces at `projects.<contractordomain>`. **A cookie scoped to
`.buildsuite.ai` will not be sent to `projects.<contractordomain>`.** The two
statements can't both hold as written.

Three ways out, and they are not equivalent:

| Option | What it means |
|---|---|
| **Hub on a `.buildsuite.ai` subdomain** | D-006 stands unchanged, cookie rides along, cheapest to build. But the Hub then lives under BuildSuite's domain, which sits oddly with "distinct system" and with the §2 per-contractor routing. |
| **Hub on its own domain, GHL as the identity provider** | The Hub does its own GHL login/OAuth rather than borrowing BuildSuite's cookie. Same identity, same users, independent session. More work, and it needs a GHL app/OAuth client — but it matches "distinct system" and the §2 routes. |
| **Hub on its own domain, shared-secret JWT** | Sing issues a token the Hub verifies. Workable, but invents an auth path neither system has today. |

**Recommendation: option 2.** A distinct system should own its own session. Option
1 is faster but couples the Hub's URL to BuildSuite's domain permanently, and
un-picking that later means re-authenticating every user.

---

### D-007 · BuildSuite holds a GHL private integration key — the sync-back may not be ours to build
**Found:** 2026-08-06 · **Supersedes the framing of D-005**

BuildSuite authenticates to GoHighLevel with a **GHL private integration key**
(and, per its API reference, agency-level OAuth tokens from the marketplace
callback). Its server can already talk to GHL server-to-server.

**That inverts §8.3.** The stage sync-back exists to move GHL's pipeline stage
into BuildSuite's "My Projects" view. If BuildSuite can query GHL directly, the
job belongs **on Sing's side**, and three problems disappear together:

| Problem from D-005 | Status if BuildSuite runs it |
|---|---|
| No machine auth on BuildSuite's API | Irrelevant — nothing calls it from outside |
| A scoped service token, ~1 day of Sing's time | Not needed |
| `buildsuite_project_id` missing from BuildSuite's API | Dissolves — BuildSuite queries GHL by whatever key it stamped at handoff, and it already knows its own `projects.id` |

**Recommendation: propose it to Sing before either side builds anything.** He owns
both ends of that path already. Our side keeps the one-way boundary §1.1
describes, and we delete a workstream rather than working around a missing token.

**The second implication — our GHL access may already exist.** If BuildSuite holds
a private integration key for the contractor sub-accounts, the hub might not need
Chris to provision a new one. Three things to settle before assuming that:

1. **Is the key agency-level or per-sub-account?** ARCHITECTURE §2 requires each
   sub-account to use its own token. An agency-level key spanning every contractor
   is a much larger blast radius than the architecture asks for.
2. **What scopes does it carry?** Ours needs custom objects, contacts, and
   opportunities. Reusing a key scoped for something else either over-grants or
   under-delivers.
3. **Lifecycle coupling.** Sharing one key means BuildSuite rotating it silently
   breaks the hub. A separate key for the hub, even minted from the same place, is
   worth the five extra minutes.

**Recommendation:** ask to *mint a separate key the same way*, not to share the
existing one.

---

### D-006 · The project hub uses the same authentication as BuildSuite
**Decided:** 2026-08-06

The hub authenticates the same way the BuildSuite app does — the GoHighLevel login
flow issuing the HTTP-only `bs_session` JWT. We do not run a separate identity
system.

**What this settles.** Our demo cookie gets replaced by real `bs_session`
verification, and because the hub sits on a `.buildsuite.ai` subdomain
(`COOKIE_DOMAIN=.buildsuite.ai`), the cookie rides along automatically — so the
hub can call BuildSuite's API **as the signed-in user**, with that user's own
permissions, and no token handling on either side. It also satisfies the CORS
restriction to `buildsuite.ai` origins for free, and answers Phase 0's "how is a
portal-authenticated contact identified server-side" for contractor and field users.

**Three things it does NOT settle — flagging rather than assuming:**

1. **The scheduled sync-back still needs option B.** A user session cannot run an
   unattended hourly job. Either Sing adds the scoped service token, or §8.3 stops
   being scheduled and becomes refresh-on-visit — which is a real product change,
   not an implementation detail, because a stage would then only reach BuildSuite
   when somebody happens to open the hub.
2. **Client-portal users are a different population.** Homeowners sign in to GHL's
   *native* Client Portal (§12.3); it is not established that they receive a
   `bs_session` at all. If they don't, the hub needs two verification paths — one
   for staff, one for clients — and the §9.1 gate must resolve the requesting
   contact from whichever is present. Needs confirming before the client portal
   goes live.
3. **Hosting is now constrained, not open.** The hub must be served from a
   `.buildsuite.ai` subdomain for the cookie to be sent. That removes the free
   choice of hosting target and makes the subdomain a dependency on Sing's DNS.

**Consequence for the build:** session verification stays behind the same
interface the demo cookie uses (`lib/session.ts`), so swapping it is one file. What
it needs from Sing is the JWT verification material — see
`What_We_Need_From_Sing.md` §1.5.
