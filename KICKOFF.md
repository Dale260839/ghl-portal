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
| **F1** | **Front-end stack for the [CODE] surfaces.** Is the Contractor Dashboard / Client Portal *entirely* GHL AI Studio (I write no UI, only the data layer feeding it), or is AI Studio the prototype and we build a real front-end against the GHL API? This is the single largest scope fork in the plan — it is the difference between ~3 days of work in Week 2 and ~8. | Phases 3–4 | **Day 2** |
| **F2** | **Where WF1–WF8 actually get built.** ARCHITECTURE §11 describes them as GHL-native workflows, but there's an n8n instance wired up on this machine. GHL-native survives the Phase 6 snapshot; n8n does not — it becomes a per-account setup step. | Phase 2, Phase 6 | **Day 3** |
| **F3** | **GHL integration token + API base URL** for the build sub-account (D3, Sing owns), and whether I'm allowed to hit it directly. Without it I can write the sync-back job but not run it against anything. | Sync-back job | **Day 3** |
| **F4** | **Where the sync-back job runs and what it writes into.** §8.3 says it updates BuildSuite's "My Projects" view — is that a BuildSuite API endpoint Sing exposes, a Supabase table, or a direct DB write? And does it deploy as a cron, a Supabase edge function, or a GHL-side schedule? | Sync-back job | **Day 3** |
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

### What I'm doing next, unblocked

Nothing until F1/F2 land. Building a front-end or a workflow against the wrong
answer to either is the most expensive mistake available this week — which is why
they're Day 2–3 questions and not Week 2 questions.
