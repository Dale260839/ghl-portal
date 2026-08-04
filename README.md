# BuildSuite™ Three-Experience Platform — code repo

The **[CODE]** half of the BuildSuite → GoHighLevel build. The other half lives
inside the GHL UI (custom objects, pipeline, workflow builder, snapshots, portal
settings) and is tracked in [KICKOFF.md](KICKOFF.md) alongside it.

## Read in this order

1. **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — canonical, v1.0. When code,
   prompts, or any other doc disagrees with it, **it wins** (§0). Do not invent
   schema, field names, stage names, or visibility rules; if something needed
   isn't in there, it's an open decision (§16) — stop and ask.
2. **[KICKOFF.md](KICKOFF.md)** — the three-week phase plan, owners, gates, and
   risk register. Sequencing only; it never overrides the architecture.
3. **[docs/PHASE-0.md](docs/PHASE-0.md)** — the Day 1 go/no-go runbook for Chris
   and Pat. Nothing in Phase 1+ starts until it passes.
4. **[docs/reference/](docs/reference/)** — the kickoff plan and Sing's technical
   review, kept for provenance. Superseded by the files above on conflict.

`CLAUDE.md` carries the same rules for any agent working in here.

## Layout

```
apps/web/               Next.js app — all three experiences (decision D-001)
packages/contracts/     Verbatim contracts from ARCHITECTURE.md — zero decisions
```

## Running the demo

```bash
npm install
npm run dev          # http://localhost:3000
```

Sign in as any of three identities — no password, it's a demo build:

| Experience | Email | Sees |
|---|---|---|
| Contractor Dashboard | `marcus@allianceproservices.com` | Everything — portfolio, projects, financials, review queue |
| Field Interface | `tony@allianceproservices.com` | Assigned projects, today's tasks, the daily update form |
| Client Portal | `dana@example.com` | Two projects, approved content only |

**The demo runs on fixtures**, and every screen says so in a banner. The GHL data
source drops in behind `ProjectDataSource` in `apps/web/src/lib/data/source.ts`
once the integration token lands — no screen changes.

### The loop worth showing

1. Sign in as **Tony** (field), submit a daily update. Note the form has two
   separate note fields and no publish button anywhere on it.
2. Sign in as **Marcus** (contractor) → **Field Updates**. The update is
   `Pending`. His internal notes are visible and flagged; the client summary is
   editable.
3. Hit **Approve and Publish**.
4. Sign in as **Dana** (client). The update is there — the edited summary only.
   The internal notes are not, and never were: they aren't hidden by the
   template, they are never read by the query.

On the contractor's project page, **"See what the client sees →"** renders the
portal through the same gate, so the difference is visible side by side.

## Enforcement, verified

Client-facing reads go through `apps/web/src/lib/client-view.ts`, which imports
`server-only` — if it is ever pulled into a client component, the build fails.
It applies the §9.1 gate, then projects onto an explicit **allow-list** rather
than filtering a deny-list, so a newly added internal field cannot reach a
client by default. `assertNoInternalFields` runs as a backstop on top.

Smoke-tested against the running app: original estimate, markup, margin, internal
notes, and delay reasons appear **zero** times in the client portal HTML;
un-published updates do not appear; and requesting another contact's project by
URL returns the requester's own project rather than the target.

## `packages/contracts`

The invariants that every other surface depends on, transcribed from the
architecture with a § reference on each one:

| Module | Covers |
|---|---|
| `ids.ts` | §5 — `BSP-YYYY-NNNNNN`, the only join key |
| `enums.ts` | §7 pipeline · §6.3 task status · §6.7 issue category · §6.4 approval status |
| `deny-list.ts` | §9.3 — internal fields, stripped and asserted at the data layer |
| `gate.ts` | §9.1 — the gate · §9.2 — auth tiers |
| `handoff.ts` | §8.2 — the BuildSuite → GHL payload |
| `project-schema.ts` | §6.1 — every `Project` field, its type, and its CV eligibility |
| `daily-update.ts` | §6.4 fields + §10 — the publishing state machine |

```bash
cd packages/contracts
npm install
npm test          # 34 invariant tests, no build step (Node ≥22.6 strips types)
npm run typecheck
```

The tests are the §3 invariants made executable — cross-project leakage,
`Approved Internally` never reaching a client, internal fields stripped from
nested payloads, and an exhaustive search proving no field user can reach a
client without a PM in the path. A change that breaks one of them is a defect
regardless of what else passes (§0).

`demoableCoreFields()` is the Phase 1 build list: the ten fields that go on the
`Project` object and nothing else.

## Two things worth knowing before you touch this

- **`Approved Internally` is not "approved" for gate purposes.** §10 keeps
  `Client Visible = No` at that state; only `Approved & Published` (WF4) reaches
  a client. `gate.ts` encodes that, and it is the single easiest rule to get
  wrong.
- **A contact may have many projects (§1.4).** Nothing here collapses a contact
  to one project, and nothing downstream should either — retrofitting it later
  touches every query and every screen.
