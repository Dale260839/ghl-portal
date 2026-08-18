# BuildSuite™ → GHL three-experience platform — kickoff

**Date:** 2026-07-31 · **Repo:** `ProgrammingProjects/ghl-portal/`
**Window:** 2026-07-31 → 2026-08-21 (3 weeks)

BuildSuite keeps estimating, proposals, takeoffs, and profitability. At proposal
signing it hands off to GoHighLevel, which owns everything operational. The three
"experiences" — Contractor Dashboard, Field Interface, Client Portal — are not
three systems; they are three permission-controlled views of one shared GHL
project record.

---

## The shape of the work

**Roughly 60% GHL configuration, 40% code.** The custom objects, pipeline,
workflow builder, snapshots, and portal settings are all clicked together in the
GHL UI by other people. Only the handoff contract, the sync-back job, the
data-layer enforcement, and (pending a decision) the front-ends are code.

Every line of the plan is tagged `[GHL]` or `[CODE]` for exactly this reason.
Estimating it as a normal codebase overstates what's buildable in the repo.

**Team:** Sing owns the BuildSuite-side Send-to-CRM handoff extension. Chris +
Pat own the GHL build and the Phase 0 gates. Dale owns workflows WF1–WF8.

---

## Repo layout

```
docs/ARCHITECTURE.md      canonical v1.0 — wins every conflict
docs/PHASE-0.md           the Day 1 go/no-go runbook
docs/eod/                 dated status notes
KICKOFF.md                3-week plan, owners, risk register, open questions
CLAUDE.md                 build rules for any agent working in here
packages/contracts/       the architecture's invariants as running code
```

Nothing else exists yet, deliberately — the architecture's own rule is "ship
slices, prove the chain before widening scope."

---

## The pattern worth reusing: contracts as tests

`packages/contracts` contains **zero design decisions**. Every constant is
transcribed from the architecture with a `§` reference. Its value is that the
rules become executable:

| Module | Encodes |
|---|---|
| `ids.ts` | The shared key `BSP-YYYY-NNNNNN` — throws rather than defaulting |
| `enums.ts` | Pipeline stages, task status, issue category, approval status |
| `gate.ts` | The client-visibility gate + auth tiers |
| `deny-list.ts` | Internal fields, stripped recursively from any response |
| `project-schema.ts` | All 49 `Project` fields, types, client-visibility eligibility |
| `daily-update.ts` | The publishing state machine as a transition table |

34 tests, no build step (Node ≥22.6 strips types natively), `npm test`.

**The two tests doing real work:**

- **No cross-project leakage** — Client A's request cannot resolve Client B's
  records, asserted at the data layer rather than in a screen.
- **No path from field to client without a PM** — a breadth-first search over
  every legal move a field user can make, proving they only ever reach `DRAFT`
  and `PENDING`. The rule "field updates are never auto-published" stops being
  something to remember and starts being something that fails a build.

**Deny-list normalization.** Field names arrive as `Internal Notes` from the
spec, `internal_notes` from a webhook, and `internalNotes` from TypeScript.
Matching on a normalized key (lowercase, strip non-alphanumerics, split
camelCase) catches all three. Matching on the literal spec spelling catches one.

---

## The invariant everyone gets wrong

**`Approved Internally` is not "approved" for the client.** The state machine has
four approval values, and two of them contain the word "Approved". Only
`Approved & Published` reaches a client — internal approval explicitly keeps
`Client Visible = No`.

This is encoded as `PUBLISHED_APPROVAL_STATUS` so no one writes the string
literal and picks the wrong one.

Three more, in `CLAUDE.md`: the gate is a data-layer rule and never only a UI
rule; a contact may have many projects (never collapse it to one); the project ID
is the only join key (never match on name, address, email, or opportunity title).

---

## Contradictions found by transcribing

Mechanically mirroring a spec into typed code surfaces things reading it doesn't:

- **19 or 20 pipeline stages?** The architecture lists 19 sequential; the kickoff
  PDF says 20. Architecture wins per its own precedence rule, so the code encodes
  19 — but whoever builds the pipeline in GHL needs to know before counting.
- **Financial gate: AND or OR?** Written as "Show Budget to Client / Show
  Detailed Pricing" with no statement of which. Implemented as OR, flagged in a
  code comment with a note on how to flip it.
- **A switch that gates nothing.** `Show Schedule to Client` is defined as a
  field but never mapped to any other field. Probably the Dates group — but
  that's a guess, so it isn't encoded.

None were blocking. All three would have become silent wrong behavior if guessed.

---

## Open questions (blocking, as of kickoff)

| # | Question | Why it matters |
|---|---|---|
| F1 | Is the dashboard/portal entirely GHL AI Studio with code only underneath, or is AI Studio a prototype and we build a real front-end on the GHL API? | Biggest scope fork — roughly 3 days vs 8 in week 2 |
| F2 | Do the workflows get built GHL-native or in n8n? | GHL-native survives the deployment snapshot; n8n becomes a per-account setup step |
| F3 | GHL integration token + API base URL | Can't run the sync-back job against anything without it |
| F4 | Where does the sync-back job run and what does it write into? | The spec says "BuildSuite's My Projects" without naming a mechanism |

Plus four architecture-level decisions (portal packaging, master key confirmation,
dedicated build sub-account, plan-tier availability).

**Test B answers F1 for free** if whoever runs it notes *how* the value bound and
whether it can filter by signed-in contact.

---

## Schedule honesty

The project's own documents estimate full V1 at 3–5 weeks. The commitment is 3.
So: weeks 1–2 (the demoable slice — signed proposal → project appears → stage
moves → client sees progress) are committed scope; week 3's remainder is the
compressible surface.

Validating the deployment snapshot in the first live sub-account does **not** fit
inside the window. Planned for the following Mon–Tue rather than discovered on
the last day.
