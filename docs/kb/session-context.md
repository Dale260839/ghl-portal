# BuildSuite → GHL — full session context

**Paste this whole file into a fresh Claude session to hand over the project.**
Self-contained: what this is, the rules that can't be broken, what exists, what's
guessed, what's left, what's blocked.

**Repo:** `c:\Users\John\ProgrammingProjects\ghl-portal` · `github.com/Dale260839/ghl-portal`
**Live:** https://project-hub-one-vert.vercel.app — deploys automatically on push
**Last updated:** 2026-08-14 · **Tests:** 198 green (164 web, 34 contracts) · **Build:** clean

---

## 1. What this is

BuildSuite handles estimating, proposals, takeoffs, profitability. When a proposal
is signed it hands the project to GoHighLevel (GHL), which owns everything
operational after. Three experiences — **Contractor Dashboard**, **Field
Interface**, **Client Portal** — are three permission-controlled views of **one
shared project record**, not three systems.

The Hub is a **distinct product** from BuildSuite, **multi-tenant**: one
deployment serving many premium clients, each with their own GHL sub-account.

**Team:** Dale (the user) owns workflows and this codebase · Sing owns BuildSuite
· Chris (CEO) + Pat own the GHL build. First deployment: Alliance Pro Services.
**Deadline:** 2026-08-21.

---

## 2. Non-negotiable rules

### Live-system guardrails (standing, from the user)

1. **Supabase is PRODUCTION. Never alter a table.** No schema changes, no
   migrations, no `ALTER`/`DROP`/`TRUNCATE`, no destructive writes. Read-only
   unless told to make one specific, named write.
2. **Ask before acting on any live system.** Reads fine; writes confirmed first.
3. **Never invent a fallback that writes.** If a read fails, report it.

### Architecture rules

`docs/ARCHITECTURE.md` v1.0 is **canonical** — it wins over code, other docs, and
your own reasoning. Field names and enum values are **verbatim**:
`Approved & Published`, not `Approved and Published`.

**Do not invent schema.** If something isn't in the architecture it's an open
decision — flag it. Where code had to pick, the guess is isolated, marked
PROVISIONAL, and listed in §6.

### The five invariants most likely to get broken

1. **`Approved Internally` is NOT approved for the client.** Four approval values,
   two contain "Approved". Only `Approved & Published` reaches a client. Use
   `PUBLISHED_APPROVAL_STATUS`, never a literal.
2. **The gate is a data-layer rule, never a UI rule.** A client response assembled
   anywhere that skips `evaluateGate` is a defect even if the UI hides it.
3. **Every staff read is tenant-scoped.** `TenantScope` is a required first
   argument. There is no unscoped overload. Measured leak, not hypothetical: 43
   active projects across 5 contractors were visible to everyone.
4. **A contact may have many projects.** Never collapse a contact to one project.
5. **Never match records by name, address, email, or opportunity title.** The join
   key is `ghl_opportunity_id` — see §6, this changed.

---

## 3. Decisions (don't relitigate)

| # | Decision |
|---|---|
| **D-001** | Front-end built **in this repo**, not GHL AI Studio. §12.3 still holds: contracts, invoices, receipts, payments route through GHL's **native** Client Portal; we are the tracking layer. |
| **D-002** | WF1–WF8 are **application code here**, not GHL-native, not n8n. §11 remains the *specification*; only the implementation moved. |
| **D-003** | Direct GHL API access approved, with the guardrails above. |
| ~~D-004~~ | ~~Sync-back through Sing's API~~ — **dead**, see D-009. |
| ~~D-005~~ | ~~Sync-back blocked: BuildSuite's API has no machine auth~~ — **moot**, see D-009. |
| ~~D-006~~ | ~~Hub uses `bs_session`~~ — **superseded by D-011.** |
| **D-007** | BuildSuite already holds a **GHL private integration key**, so the stage sync-back probably belongs on Sing's side. Proposed; awaiting his answer. |
| **D-008** | The Hub is a **distinct system** with its own two credentials. |
| **D-009** | **Data access is Supabase-direct.** We never call BuildSuite's API. Closes D-004, moots D-005. |
| **D-010** | **`BSP-YYYY-NNNNNN` does not exist** in BuildSuite's database. 53 columns on `projects`, none of them a BSP id. Every row has `ghl_contact_id` and `ghl_opportunity_id`. **Recommending we adopt `ghl_opportunity_id` and amend §5/§3.6 — awaiting Chris.** |
| **D-011** | **Auto-login via GHL Custom Menu Link.** Signed in to GHL = signed in to the Hub. We mint our own session on our own domain, so no `bs_session` and no `.buildsuite.ai` subdomain requirement — which frees the Hub to live at `projects.<contractordomain>` as §2 specifies. |
| **D-012** | **Every staff read is scoped to one contractor.** Tenant key: `projects.auth_profile_id`. |
| **D-013** | **Multi-tenant across sub-accounts.** Location is per-request, never an env var. Tenancy is two-dimensional: `locationId` scopes GHL reads, `auth_profile_id` scopes Supabase reads. Recommending a GHL Marketplace app (OAuth) over per-sub-account keys before the second client. |

**Phase 6 shrank.** The snapshot ships objects, fields, pipeline, forms,
templates, roles, portal settings — not the app or the workflows. Those are one
deployment serving all sub-accounts. Better operationally, but "build once,
snapshot everywhere" was part of the original justification.

Full reasoning: `KICKOFF.md` §6.

---

## 4. Layout

```
docs/ARCHITECTURE.md            canonical spec
docs/PHASE-0.md                 go/no-go runbook (STILL NOT RUN)
docs/What_We_Need_From_Sing.md  integration ask
docs/kb/decisions-for-chris.md  what's blocked on Chris, ranked
docs/eod/                       dated status notes
KICKOFF.md                      plan · decision log §6 · open questions §5
CLAUDE.md                       build rules for agents
vercel.json                     monorepo build config

packages/contracts/src/         the architecture's rules as code — ZERO decisions
  ids · enums · field-names · deny-list · gate · handoff
  project-schema (§6.1) · daily-update (§6.4 + §10 state machine)

apps/web/src/
  app/                          routes (§5)
  lib/tenancy.ts                TenantScope, assertScope — fails closed
  lib/scope.ts                  requireTenantScope (staff) · scopeOfProject (client)
  lib/session.ts                signed session cookies
  lib/auth/session-crypto.ts    HMAC sign/verify, expiry, secret resolution
  lib/auth/ghl-landing.ts       Custom Menu Link verification (D-011)
  lib/client-projection.ts      the gate + allow-list projection (PURE, tested)
  lib/client-view.ts            server-only re-export of the above
  lib/data/                     types · fixtures · source (the seam) · mutations · ghl-source
  lib/buildsuite/               live Supabase reads — read-only by construction
  lib/ghl/                      config · errors · client · mapper · location
  lib/workflows/                effects · defaults · executor · ports · fixture-ports
                                wf1 · wf2 · wf3 · wf4 · wf7
```

Two npm workspaces. Node ≥22.6 strips TypeScript natively, so `packages/contracts`
ships raw `.ts` with **no build step**; the web app consumes it via
`transpilePackages`. **Relative imports need explicit `.ts` extensions** — that's
what lets `node --test` run without a bundler.

---

## 5. What EXISTS and works

| Route | Role | What |
|---|---|---|
| `/` | — | Sign-in, four demo identities |
| `/api/auth/ghl` | — | GHL Custom Menu Link landing (D-011) |
| `/dashboard` | contractor | Portfolio Overview |
| `/dashboard/projects` | contractor | Projects List |
| `/dashboard/projects/[id]` | contractor | Project Overview |
| `/dashboard/projects/[id]/visibility` | contractor | Client Visibility Settings |
| `/dashboard/updates` | contractor | Field Update Review — seven verbatim actions |
| `/dashboard/issues` | contractor | Issues (§6.7) |
| `/dashboard/buildsuite` | contractor | **LIVE** BuildSuite projects from Supabase |
| `/field` | field | Mobile: today's tasks, daily update form |
| `/portal` | client | Switcher, progress, schedule, budget, published updates |

**Phase 3's six screens are complete.** WF1, WF2, WF3, WF4, WF7 exist as pure
tested planners with an executor. `/dashboard/buildsuite` reads **live production
data**; everything else is fixtures, bannered as such on every screen.

### Security, in layers

**Tenancy (D-012/D-013).** `TenantScope` is a required first argument on every
staff read. `assertScope` fails closed. The tenant filter is built *inside* the
reader from the asserted scope, never passed in — a caller that can supply its own
filter can supply none. Lookups filter *before* matching. Clients aren't tenants:
`scopeOfProject` derives a scope from a project they were already authorized to
see, and takes a whole `Project` so only someone holding one can call it.

**The client gate.** `evaluateGate` (four clauses, returns the first failure) →
allow-list projection → `assertNoInternalFields` backstop. `client-view.ts`
imports `server-only`, so pulling enforcement into a client component **fails the
build**.

> **Allow-list, not deny-list.** A deny-list means a new internal field reaches
> the client until someone remembers to add it. An allow-list means it never does
> until someone deliberately adds it. Same code, opposite failure mode.

**Sessions.** HMAC-signed, versioned, 8-hour expiry, timing-safe comparison,
signature verified *before* the payload is parsed. Production refuses to start
without `SESSION_SECRET`; development generates one per process.

**Supabase reads.** Read-only by construction: the client exposes only `select`
and `count`, both GET. `select(*)` is refused — columns must be named, which stops
a schema addition silently widening what we pull and keeps us out of columns we
have no screen for.

### Rules encoded as refusals

Worth knowing, because they look like bugs if you don't:

- The **development GHL token resolver refuses any location** but its own. Returning
  the build token for anything would work with one sub-account and cross tenants
  with two.
- An **unparseable checkbox is `false`** — `clientPortalEnabled` is a gate clause,
  so unreadable must close it.
- An **unrecognised §6.7 issue category is refused**, not coerced to `Other` —
  coercion would swallow a mis-typed "Safety Concern".
- **Two matching auth profiles returns null.** Guessing puts someone in the wrong
  tenant, silently.
- **Unsigned GHL landings are refused in production.** Merge-field query params are
  not authentication.

---

## 6. What is GUESSED (all flagged, all isolated)

Never present these as settled.

| # | Guess | Where | Needs |
|---|---|---|---|
| **W1** | Stage → progress mapping. §11 requires it, never defines it. | `workflows/defaults.ts` | Chris |
| **W2** | Default milestones (7) and tasks (2). Neither list exists. | `workflows/defaults.ts` | Chris |
| **W3** | Which stages notify the client. "When appropriate" is undefined. | `workflows/defaults.ts` | Chris |
| — | GHL response shapes and field keys | `ghl/mapper.ts` | A real payload |
| — | GHL endpoint paths | `data/ghl-source.ts` | Phase 0 |
| — | Financial gate AND vs OR — §9.3 writes it as a slash. Implemented OR. | `project-schema.ts` | Chris |
| — | `Show Schedule to Client` is named but never mapped to fields | — | Chris |
| — | **19 vs 20 pipeline stages.** Architecture says 19, kickoff PDF says 20. Built to 19. | `contracts/enums.ts` | Chris, before the pipeline is created |
| — | GHL user → `auth_profiles.id` matched on email + location. Fuzzy; wants the GHL user id stored on the profile. | `buildsuite/projects.ts` | Sing |

---

## 7. What is NOT real yet

| Thing | State |
|---|---|
| Most data | Fixtures, bannered. Only `/dashboard/buildsuite` is live. |
| GHL side | No `GHL_PROJECT_OBJECT_KEY`, so it stays on fixtures. |
| Sign-in | Demo accounts. The GHL landing route exists and is tested but has never run against a real menu link. |
| Publish state | In memory; resets on restart. |
| Workflow effects | Fixture-backed handlers. No GHL write path. |
| WF5, WF6, WF8 | Not built. |
| Hosting | Not deployed. `vercel.json` is in place. |

---

## 8. Blocked on

1. **The domain** — blocks deploying and testing login. Options and a
   recommendation are in `docs/kb/decisions-for-chris.md`.
2. **`GHL_PROJECT_OBJECT_KEY`** — the private integration key works, but alone it
   can't address a custom object.
3. **D-010** — the join key. Our code still *rejects* anything not `BSP-`, so the
   rework grows daily.
4. **Phase 0** has never been run.

**Credentials we have:** Supabase URL + publishable key (in `.env.local`,
gitignored), and a GHL private integration key.

**Security item raised with Sing:** BuildSuite's publishable key can read
`contractors` including names and phone numbers. Publishable keys are meant for
browsers, so that data is effectively public. Not ours to fix; flagged.

---

## 9. Running it

```bash
npm install
npm run dev                               # http://localhost:3000
npm test                                  # contracts (34)
npm test --workspace @buildsuite/web      # web (152)
npm run build --workspace @buildsuite/web
```

No `.env` needed for fixtures. Sign in as `marcus@allianceproservices.com`
(contractor), `priya@allianceproservices.com` (**a second tenant** — proves
scoping), `tony@allianceproservices.com` (field), or `dana@example.com` (client,
two projects). No password.

**The loop worth demoing:** submit an update as Tony → it lands `Pending` in
Marcus's queue with internal notes flagged and the client summary editable →
Approve and Publish → sign in as Dana and it's there, edited summary only. The
internal notes weren't hidden by the template; they were never read.

**The tenancy demo:** sign in as Marcus, then Priya. Different projects, zero
overlap, on both fixtures and live data.

---

## 10. Conventions

- TypeScript, ESM, **`.ts` extensions on relative imports** (no build step).
- `packages/contracts` contains **zero design decisions** — every constant carries
  a `§` reference. Adding to it means adding the reference.
- Tests encode invariants. A test named `§3.2 …` asserts an architectural MUST —
  if it fails, fix the code, not the test.
- Commits authored as `Dale <dalesolution123@gmail.com>`. The remote is
  `https://Dale260839@github.com/...` — the username in the URL is deliberate; it
  makes Credential Manager resolve the right account.
- Status notes name gaps rather than rounding up.
