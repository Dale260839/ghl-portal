# Working in this repo

## 🛑 Live-system guardrails — read before touching anything

These are standing rules from the project owner (decision D-003), not
suggestions. They apply to every session.

1. **Supabase is PRODUCTION. Never change any table.** No schema changes, no
   migrations, no `ALTER` / `DROP` / `TRUNCATE`, no destructive `UPDATE` or
   `DELETE`. Treat it as read-only unless you are explicitly told to make one
   specific, named write.
2. **Ask before acting on any live system.** Direct GHL API access is approved,
   but every write, state change, or run against live data gets confirmed first.
   Reads are fine.
3. **Never invent a fallback that writes.** If a read fails, report it. Do not
   "repair" live data to make a task complete.

## Source of truth (updated 2026-08-22)

Four documents are canonical, reconciled in `docs/SOURCE-OF-TRUTH.md`:
D1 Portal build and validation strategy · D2 Three-Experience Architecture ·
D3 Sing's technical review (2026-07-17) · D4 Project Hub build context (2026-08-21).

**D4 is the newest and wins where it disagrees with `docs/ARCHITECTURE.md`** — it is the only
one written after the client meeting and after the code existed. Six conflicts are logged in
`SOURCE-OF-TRUTH.md`; four need Chris and are marked. Do not resolve them by choosing.

### Five rules from D4 — violating one is a defect

1. **Stage completion is never set from the Hub.** GHL owns stage movement; the Hub reflects it.
2. **The field crew never touches GoHighLevel.** They only ever see the Hub.
3. **Never key a cross-system link off a job title or name.** Dedicated ID field only — a rename
   breaks the link silently and shows the wrong data on a job site.
4. **The Hub owns exactly one write: the PM's publish decision.** Everything else it reflects.
5. **Operational records belong to GHL after handoff** — milestones, tasks, updates, selections,
   change orders, invoices. The Hub does not keep a second copy.

## The rule that overrides everything else

**The four source documents above are canonical, D4 first.** Below them,
**`docs/ARCHITECTURE.md` v1.0 still governs everything they do not cover** — it is
the detailed transcription of §1–§16, and when code, a prompt, or your own
reasoning disagrees with it, the architecture wins (§0).

Order of precedence: **D4 → D1/D2/D3 → ARCHITECTURE.md → KICKOFF.md → code.**
ARCHITECTURE predates the client meeting; where D4 speaks, D4 is newer.

Field names, object names, stage names, and the shared-ID format are **verbatim
contracts** — match casing and spelling exactly. `Approved & Published` is not
`Approved and Published`. `Design and Selections` is not `Design & Selections`.

**Do not invent schema.** If something you need isn't in the architecture, it is
an open decision (§16) — stop and ask rather than picking a sensible default.
Four are already open and tracked in `KICKOFF.md` §3 and §5.

## Before writing code

0. `docs/kb/session-context.md` — full project state in one file: what exists,
   what's guessed, what's left, what's blocked. Start here if you're new to this
   repo.
1. `docs/ARCHITECTURE.md` — the contract.
2. `KICKOFF.md` — what phase we're in and what's blocked. Do not build a later
   phase's surface area before its prerequisite data and workflows exist (§0).
3. `packages/contracts/` — if a rule is already encoded there, import it. Do not
   re-implement the gate, the deny-list, or the ID format inline.

## The four invariants most likely to get broken

1. **`Approved Internally` ≠ approved for the client.** §10 keeps
   `Client Visible = No` at that state. Only `Approved & Published` (WF4)
   reaches a client. Use `PUBLISHED_APPROVAL_STATUS`, never a string literal.
2. **The gate is a data-layer rule, not a UI rule** (§9.1, §13). If a client
   response is assembled anywhere that doesn't call `evaluateGate` and
   `stripInternalFields`, that's a defect even if the UI happens to hide it.
3. **A contact may have many projects** (§1.4). Never collapse a contact to one
   project in a type, a query, or a screen.
4. **`BuildSuite Project ID` is the only join key** (§3.6). Never match records
   by name, address, email, or opportunity title.

## Boundaries

- The portals **never** call BuildSuite directly. The only BuildSuite → GHL
  channel is the Send-to-CRM handoff (§8.2); the only backward channel is the
  scheduled stage sync-back (§8.3), which is read-only against GHL.
- After handoff, GHL owns all operational records. This repo does not create
  milestones, tasks, updates, change orders, or invoices in BuildSuite.

## Conventions

- TypeScript, ESM, `.ts` extensions on relative imports (Node strips types
  natively — no build step).
- `packages/contracts` contains **zero design decisions**. Every constant is
  transcribed with a `§` reference. If you add to it, add the reference too.
- Tests encode invariants, not implementation. A test named `§3.2 ...` is
  asserting an architectural MUST — if it fails, fix the code, not the test.

```bash
cd packages/contracts && npm test && npm run typecheck
```
