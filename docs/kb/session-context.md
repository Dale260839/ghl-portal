# BuildSuite → GHL — full session context

**Paste this whole file into a fresh Claude session to hand over the project.**
It is written to be self-contained: what the project is, the rules that can't be
broken, what exists, what's guessed, what's left, and what's blocked.

**Repo:** `c:\Users\John\ProgrammingProjects\ghl-portal` · `github.com/Dale260839/ghl-portal`
**Last updated:** 2026-08-06 · **Tests:** 88 green · **Build:** clean

---

## 1. What this is

BuildSuite handles estimating, proposals, takeoffs, and profitability. When a
proposal is signed it hands the project off **once** to GoHighLevel (GHL), which
owns everything operational from then on. Three user experiences —
**Contractor Dashboard**, **Field Interface**, **Client Portal** — are not three
systems. They are three permission-controlled views of **one shared project
record**.

**Team:** Dale (the user) owns workflows and this codebase · Sing owns the
BuildSuite side and its API · Chris (CEO) + Pat own the GHL build and validation.
First live deployment target is Alliance Pro Services.

**Deadline:** 3-week window ending 2026-08-21.

---

## 2. Non-negotiable rules

### Live-system guardrails (from the user, standing)

1. **Supabase is PRODUCTION. Never alter a table.** No schema changes, no
   migrations, no `ALTER`/`DROP`/`TRUNCATE`, no destructive `UPDATE`/`DELETE`.
   Read-only unless told to make one specific, named write.
2. **Ask before acting on any live system.** Reads are fine; every write or state
   change gets confirmed first.
3. **Never invent a fallback that writes.** If a read fails, report it.

### Architecture rules

`docs/ARCHITECTURE.md` v1.0 is **canonical** — when code, another doc, or your own
reasoning disagrees with it, it wins. Field names, enum values, and stage names
are **verbatim contracts**: `Approved & Published`, not `Approved and Published`.

**Do not invent schema.** If something needed isn't in the architecture, it's an
open decision — flag it and ask rather than picking a sensible default. Where
code had to pick, the guess is isolated in one file, marked PROVISIONAL, and
listed in §6 below.

### The four invariants most likely to get broken

1. **`Approved Internally` is NOT approved for the client.** Four approval values,
   two contain "Approved". Only `Approved & Published` reaches a client. Use
   `PUBLISHED_APPROVAL_STATUS`, never a string literal.
2. **The gate is a data-layer rule, never a UI rule.** A client response assembled
   anywhere that skips `evaluateGate` is a defect even if the UI hides it.
3. **A contact may have many projects.** Never collapse a contact to one project
   in a type, a query, or a screen.
4. **`BuildSuite Project ID` is the only join key.** Format `BSP-YYYY-NNNNNN`.
   Never match by name, address, email, or opportunity title.

---

## 3. Decisions already made (don't relitigate)

| # | Decision | Consequence |
|---|---|---|
| **D-001** | Front-end built in this repo, **not GHL AI Studio** | AI Studio couldn't carry three permission-controlled experiences. The §12.3 split still holds — contracts, invoices, receipts, payments route through GHL's **native** Client Portal; we are the tracking layer. |
| **D-002** | WF1–WF8 are **application code here**, not GHL-native, not n8n | §11 is still the *specification*; only the implementation moved. GHL/BuildSuite/Supabase treated as integrated systems over a shared DB. |
| **D-003** | Direct GHL API access approved, with the guardrails above | |
| **D-004** | Stage sync-back writes through **Sing's existing BuildSuite API** | **⚠️ INVALIDATED by D-005.** |
| **D-005** | Sync-back is **blocked on a design decision, not a key** | BuildSuite's API has **no machine auth** — every endpoint needs a `bs_session` cookie from the GHL login flow. `BUILDSUITE_API_KEY` doesn't exist. A scheduled server-to-server job cannot call it. Also: `PUT /projects/{id}` is documented broken, and **`buildsuite_project_id` appears nowhere in that API** — which puts the whole shared-key premise in question. Do not build the sync-back until resolved. |
| **D-006** | The hub uses **the same authentication as BuildSuite** — GHL login issuing `bs_session` | No separate identity system. Requires the hub on a `.buildsuite.ai` subdomain (cookie domain), which **constrains hosting**. Does *not* solve the scheduled sync-back, and it's unconfirmed whether client-portal homeowners get a `bs_session` at all. |

**D-001 + D-002 shrink the Phase 6 snapshot.** It ships objects, fields, pipeline,
forms, templates, roles, portal settings. The app, workflows, and sync-back job
deploy separately per sub-account. "Build once, snapshot everywhere" is a smaller
multiplier than the original plan assumed — Chris and Pat need this before Phase 6.

---

## 4. Layout

```
docs/ARCHITECTURE.md          canonical spec — wins every conflict
docs/PHASE-0.md               go/no-go runbook (NOT yet run)
docs/What_We_Need_From_Sing.md the integration ask
docs/kb/                      knowledge base (this file lives here)
docs/eod/                     dated status notes
KICKOFF.md                    plan, decision log §6, open questions §5
CLAUDE.md                     build rules for agents

packages/contracts/src/       the architecture's rules as code — ZERO decisions
  ids · enums · field-names · deny-list · gate · handoff
  project-schema (§6.1, 49 fields) · daily-update (§6.4 + §10 state machine)

apps/web/src/
  app/                        routes (see §5)
  components/ui.tsx           shared UI
  lib/session.ts, actions.ts  demo auth + server actions
  lib/client-projection.ts    gate + allow-list projection (PURE, tested)
  lib/client-view.ts          server-only re-export of the above
  lib/data/                   types · fixtures · source (the seam) · mutations · ghl-source
  lib/ghl/                    config · errors · client · mapper
  lib/workflows/              effects · defaults · wf1-new-project · wf2-stage-sync
```

Two npm workspaces. Node ≥22.6 strips TypeScript natively, so `packages/contracts`
ships raw `.ts` with **no build step**; the web app consumes it via
`transpilePackages`. **Relative imports need explicit `.ts` extensions** — that's
what makes `node --test` work without a bundler.

---

## 5. What EXISTS and works

### Routes

| Route | Role | Screens |
|---|---|---|
| `/` | — | Sign-in, three identities |
| `/dashboard` | contractor | Portfolio Overview — KPIs, attention list, review queue, client-waiting |
| `/dashboard/projects` | contractor | Projects List (table desktop / cards mobile) |
| `/dashboard/projects/[id]` | contractor | Project Overview — timeline, financials, visibility switches, updates |
| `/dashboard/updates` | contractor | Field Update Review — the seven verbatim actions |
| `/field` | field | Mobile-first: today's tasks, daily update form |
| `/portal` | client | Project switcher, progress, schedule, budget, published updates |

Roles are checked in each `layout.tsx` server-side and redirect.
`/portal?preview=<projectId>` lets a contractor see the client view **through the
same gate** — it resolves the contact from the project rather than bypassing.

### Security implementation (the load-bearing part)

Three layers: **the gate** (`contracts/gate.ts`, four clauses, returns the first
failing one) → **an allow-list projection** (`client-projection.ts`, DTO built
field by field) → **`assertNoInternalFields`** as backstop. Plus a structural
guard: `client-view.ts` imports `server-only`, so pulling enforcement into a
client component **fails the build**.

> **Allow-list, not deny-list.** A deny-list means a new internal field reaches
> the client until someone remembers to add it. An allow-list means it never
> reaches the client until someone deliberately adds it. Same code, opposite
> failure mode.

### The data seam

`ProjectDataSource` (`lib/data/source.ts`) has two implementations:
`FixtureDataSource` and `GhlDataSource`. `getDataSource()` picks GHL when **every**
required env var is set, fixtures otherwise — all-or-nothing, with a warning on a
half-configured environment. Every screen shows a banner while on fixtures.

**Building this seam before the credentials existed is why a demo shipped in
week 1.** Swapping the implementation touches no page.

### The GHL client (`lib/ghl/`)

Layered so a wrong guess stays cheap: `client.ts` knows HTTP, auth, retries and
**nothing about projects**; `mapper.ts` is the only file that knows response
shapes. Retry policy: 429 honours `Retry-After`; 5xx and network failures back
off with **jitter** (the hourly sync-back fires every project on the same
schedule — unjittered retries hit the limit in lockstep); **401 and 400 never
retry**.

### Workflows (`lib/workflows/`)

WF1 and WF2 are **pure planners**: trigger in, typed `Effect[]` out. No network,
no clock, no credentials — so §11 can be asserted action by action in unit tests.

- **WF1** — all ten §11 actions. Refuses a payload without a valid shared key.
  Idempotent (re-fired handoff records activity, doesn't duplicate milestones).
  Flags an unassigned PM loudly — an unassigned project has nobody to receive the
  review queue, which breaks the approval path.
- **WF2** — refuses to act without the shared key rather than name-matching,
  rejects stages outside the §7 pipeline, no-ops on a re-fired webhook.
  **On Hold / Canceled do not move the progress bar** (a project paused at 65%
  has not regressed to 0).

### Tests — 88, no framework, `node --test` + native type stripping

- **contracts (34)** — invariants as executable rules. Notable: a breadth-first
  search over the publishing state machine proving a field user can only ever
  reach `DRAFT` and `PENDING`.
- **web (54)** — 14 gate/leak (value-level, so a field rename can't slip past),
  19 transport & mapper, 21 workflow.

---

## 6. What is GUESSED (all flagged, all isolated)

Never present these as settled. Each is a one-file/one-table fix.

| # | Guess | Where | Needs |
|---|---|---|---|
| **W1** | Stage → progress mapping. §11 requires it, never defines it. Straight line anchored on the two stated figures (10% at creation, 100% at Completed). | `workflows/defaults.ts` | Chris |
| **W2** | Default milestones (7) and tasks (2) for a new project. Neither list exists anywhere. | `workflows/defaults.ts` | Chris |
| **W3** | Which stages notify the client. §11 says "when appropriate", undefined. Six stages, biased toward silence. | `workflows/defaults.ts` | Chris |
| — | GHL response shapes and field keys | `ghl/mapper.ts` | A real captured payload |
| — | GHL endpoint paths | `data/ghl-source.ts` | Phase 0 |
| — | Financial gate is AND or OR — §9.3 writes it as a slash. Implemented as OR. | `project-schema.ts` | Chris |
| — | `Show Schedule to Client` is named as a switch but never mapped to any field | — | Chris |
| — | **19 vs 20 pipeline stages** — architecture says 19 sequential, kickoff PDF says 20. Built to 19 (architecture wins). | `contracts/enums.ts` | Chris, before the pipeline is created |

---

## 7. What is NOT real yet

| Thing | State |
|---|---|
| Data | Fixtures. Banner on every screen. |
| Auth | Demo cookie, not GHL portal login. Shaped like the real thing so the swap touches one file. |
| Publish state | In memory — resets on server restart. |
| Workflow effects | WF1/WF2 **plan** effects; nothing executes them. No executor, no ports. |
| Milestones / Tasks / Daily Updates over GHL | Return empty — each needs its own object key. Screens render empty states rather than fabricating rows. |
| WF3–WF8 | Not built. |
| Deployment | Localhost only. No hosting target chosen. |

---

## 8. What to build next (ordered)

Everything in 1–4 needs **no credentials**.

1. **WF3 + WF4** — the field → PM → client publishing loop as code. Makes the
   demo's core loop real instead of in-memory. Fully specified in §11.
2. **Workflow executor + ports** — applies `Effect[]` through interfaces, with a
   fake for tests. Nothing executes effects today.
3. **Sync-back job** — scheduler, idempotency, run log, retry, against a fake
   `BuildSuiteClient`. Design hinges on whether Sing's endpoint is idempotent.
4. **Client Visibility Settings** — the one Phase-3 screen from §12.1 not built.
5. Real session plumbing (signed cookies, CSRF, role middleware) — everything
   except the identity provider, which needs Phase 0's answer.
6. GHL webhook receiver + signature verification (needs `GHL_WEBHOOK_SECRET`).
7. V1 remainder screens: issues, messages, documents, tasks.
8. WF5–WF8.

---

## 9. Blocked on

**Phase 0 has never been run.** It gates more than the keys do. Its four
questions decide whether `GhlDataSource` is shaped right:

1. Can records be queried by a **custom field** (`BuildSuite Project ID`) or only
   by GHL's internal record id? *(assumed: yes)*
2. Can records be **filtered by associated contact** in one call, or is it
   fetch-then-filter? *(assumed: no — filtering client-side)*
3. Rate limits on custom-object endpoints.
4. How a portal-authenticated contact is identified **server-side** — the biggest
   unknown for real auth.

**Keys**, all documented in `apps/web/.env.example`:

| Group | Owner |
|---|---|
| GHL — base URL, version, location id, PI token (or OAuth trio), project object key, webhook secret | Sing / Chris |
| Supabase — URL + **read** key (never `service_role`) | Dale |
| BuildSuite API — base URL, key, endpoint list, **and whether the stage update is idempotent under retry** | Sing |
| App — `SESSION_SECRET`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET` | Dale |

Plus: **hosting target** undecided.

---

## 10. Running it

```bash
npm install
npm run dev                               # http://localhost:3000
npm test                                  # contracts (34)
npm test --workspace @buildsuite/web      # web (54)
npm run build --workspace @buildsuite/web
```

No `.env` needed — with no credentials it runs on fixtures. Sign in with any of:
`marcus@allianceproservices.com` (contractor) · `tony@allianceproservices.com`
(field) · `dana@example.com` (client, two projects). No password.

**The loop to demo:** submit an update as Tony → it lands `Pending` in Marcus's
queue with internal notes flagged and the client summary editable → Approve and
Publish → sign in as Dana and it's there, edited summary only. The internal notes
aren't hidden by the template; they were never read.

---

## 11. Conventions

- TypeScript, ESM, **`.ts` extensions on relative imports** (no build step).
- `packages/contracts` contains **zero design decisions** — every constant is
  transcribed with a `§` reference. Adding to it means adding the reference.
- Tests encode invariants, not implementation. A test named `§3.2 ...` asserts an
  architectural MUST — if it fails, fix the code, not the test.
- Commits are authored as `Dale <dalesolution123@gmail.com>`. The remote is
  `https://Dale260839@github.com/...` — the username in the URL is deliberate, it
  makes Credential Manager resolve the right account.
- Status notes name gaps rather than rounding up. Claiming completion that can't
  be defended is the failure mode to avoid.
