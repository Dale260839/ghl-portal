# Project numbering convention

**Established:** 2026-09-10, from a census of live BuildSuite data.
**Encoded in:** `packages/contracts/src/ids.ts` — that file is authoritative, this
one explains it.
**Verify at any time:** `npm run check:codes` (read-only, exits non-zero on a
violation).

---

## 1 · The convention

A project code is `BSA-` followed by one of two series. Both are allocated by a
Postgres function inside BuildSuite at insert time; **the Hub never mints one.**

| Series | Shape | Counter | Live count | Reached |
|---|---|---|---|---|
| **Alliance** | `BSA-NNN` | one Alliance-wide sequence | 54 | 55 |
| **Contractor** | `BSA-XXX-NNN` | per contractor, behind a chosen 2–6 letter prefix | 2 | 2 |

Measured 2026-09-10: 107 live projects, 56 with a code, **zero duplicates**.

### The rules

1. **The whole string is the identifier.** Never the number, never the prefix.
2. **A code is unique across both series and all contractors.** This is the
   property §3.6 depends on as the only join key, and the property the homeowner
   sign-in depends on as a password.
3. **A code never changes once assigned.** It is printed on contracts, emailed
   to homeowners, and joins three systems.
4. **At least three digits**, zero-padded. More is fine — the pattern accepts
   `BSA-1000` so the Alliance series does not break at four figures.
5. **Nothing in this repo allocates a code.** If a project has none, it has none;
   the screens say so and the sign-in fails closed.

---

## 2 · The number alone is not unique — this is the trap

`BSA-002` and `BSA-APS-002` are **different projects**. So are `BSA-001` and
`BSA-APS-001`. Both pairs exist in live data right now.

Two independent counters will keep colliding on the suffix forever. So:

- never key, sort, group, compare or display on the numeric part;
- never strip the prefix to "simplify" a code for a screen;
- never assume `BSA-052` and the number 52 identify the same thing.

`projectCodeSeries()` and `projectCodePrefix()` exist so no caller has to parse
a code itself.

---

## 3 · Where a real collision could come from

**The contractor prefix is chosen, not allocated.** `APS` came from "Alliance
Pro Services". A second contractor — "Apex Plumbing Solutions", say — could
choose `APS` too, and their two per-contractor counters run independently. Both
would mint `BSA-APS-003`.

Nothing in BuildSuite prevents that today. Two defences are in place:

- **`npm run check:codes`** reports any prefix owned by more than one auth
  profile, before it produces a collision.
- **The sign-in fails closed.** `findSignedProjectForClient` refuses when a code
  matches more than one project — signing somebody into a job that might not be
  theirs is worse than refusing.

**Recommended fix at source, for Sing:** allocate prefixes from a table with a
unique constraint rather than deriving them from a business name. Cheap now,
while there is one prefix in existence.

---

## 4 · What a person types

A code is read off a printed contract, an email, or dictated down a phone. It is
also a password. `normalizeProjectCode()` is the single place that reconciles
those, and the login path calls it rather than doing its own tidying:

| Typed | Becomes |
|---|---|
| `bsa-052` | `BSA-052` |
| ` BSA-052 ` | `BSA-052` |
| `BSA 052` | `BSA-052` |
| `BSA--052` | `BSA-052` |
| `BSA-52` | `BSA-052` |
| `BSA-1000` | `BSA-1000` (untouched) |

Padding cannot create a false match: a padded code either names the project it
was meant to name or names nothing, and the email has to match as well.

`isProjectCode()` does **not** normalize. A short code reaching a comparison
un-normalized is a bug, not a fourth format entering circulation.

---

## 5 · Current state, 2026-09-10

```
projects 107 live, 56 with a code

  ok    every code is unique
  ok    every code matches PROJECT_CODE_PATTERN
  ok    1 contractor prefix(es), none shared
  warn  coded but no client_email, so no sign-in: BSA-028

  alliance series    54 codes, highest 55
  contractor series   2 codes, highest 2
```

**51 live projects have no code at all.** They cannot hand off (§3.6) and their
homeowners cannot sign in. That is a BuildSuite allocation question, not a Hub
bug — codes appear to be assigned at award or signature rather than at creation.

**`BSA-028` has a code but no `client_email`.** Nobody can ever sign in to it.

---

## 6 · Still unresolved, and not resolved here

The one live record in GoHighLevel's `custom_objects.projects` keys on a
**UUID**, not on the BSA code (C-3, `ids.ts`). Accepting `BSA-NNN` is our half;
until the GHL side is wired to the same key, a handoff still will not join.

**Do not resolve this by also accepting UUIDs.** That would make the join key
"any string", which is not a join key.
