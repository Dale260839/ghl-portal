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
packages/contracts/     Verbatim contracts from ARCHITECTURE.md — zero decisions
```

Everything else is deliberately absent until its phase arrives (§3.7, ship
slices) and until the stack question in KICKOFF.md §5 is answered.

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
