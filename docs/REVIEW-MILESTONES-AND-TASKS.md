# Review: Dale's provisional milestones and tasks

**Reviewed:** 2026-09-10.
**Verdict:** the shapes are sound and match §6.2/§6.3. **One shipping bug found
and fixed.** Three gaps need a decision that is not mine to make.

---

## 1 · The bug — editing a milestone's dates did nothing, and marked it complete

`createMilestone` wrote `planned_start` / `planned_end`. `updateMilestone` wrote
`target_date` / `completed_date`. `toMilestone` reads the first pair.

The two column pairs are both real: `target_date` and `completed_date` came with
`hub_milestones` in migration 0001, and migration 0003 added the planned pair
beside them without removing the originals. Create was updated; edit was not.

Two consequences, and the second is worse:

| | |
|---|---|
| Visible | A PM edits a milestone's dates, saves, and the screen shows the old dates. The save "worked" — a row was written. |
| Silent | The end date landed in **`completed_date`**, so a milestone nobody had finished carried a completion date. Any later reader — a report, the stage sync, a client-facing progress figure — takes that as done. |

**Fixed** in `lib/hub-db/operational.ts`; three tests added, verified by putting
the old columns back and watching two of them fail.

Nothing needs correcting in the data: `updateMilestone` has never been called
against a live row, so no `completed_date` was ever wrongly set. Worth
re-checking after this ships.

---

## 2 · Milestone status has no vocabulary — this needs a decision

§6.3 gives the Task Status enum **verbatim**, nine values, and it is transcribed
into `packages/contracts/src/enums.ts` as `TASK_STATUSES`.

§6.2 says a milestone has `Status (select)` and **never lists the values.**

So today:

- `types.ts` declares an inline union — `'Not Started' | 'In Progress' |
  'Completed' | 'Blocked'` — that is nobody's decision, just what the fixtures
  happened to use;
- `hub_milestones.status` is `text not null default 'Not Started'` with no check
  constraint;
- `updateMilestone(patch.status?: string)` accepts **any string** and writes it;
- the read casts it back with `as Milestone['status']`, so an invalid value
  type-checks its way onto a screen.

**I have deliberately not invented the list.** §16 open decision, and CLAUDE.md
is explicit: something not in the architecture is an open decision, not a
sensible default. Once Chris names the values, they belong in
`packages/contracts` with a `§` reference, and `updateMilestone` should validate
against them the way task status should.

**Recommendation:** adopt the four already in use, plus `Delayed` — but that is a
recommendation, not a change.

---

## 3 · §6.2 fields the model does not carry

§6.2 lists: Project, Milestone Name, Description, Planned Start, Planned End,
**Actual Start**, **Actual End**, Sequence/Order, **Dependency**, **Assigned
Team**, Status, **Delay Reason**, Client Visible, **Client Summary**.

The `Milestone` type carries seven of those. Missing, in the order they will be
missed:

| Field | Why it will come up |
|---|---|
| **Actual Start / Actual End** | Planned vs actual is the whole point of a schedule. Without it there is no slippage figure and "on track" is an assertion. |
| **Client Summary** | Every other client-facing record has one. A milestone is published with its raw internal name — the same problem the daily update solved with a PM-written summary. |
| **Delay Reason** | On the §9.3 deny-list, so it is internal by design — but it has to exist to be withheld. |
| **Dependency** | Sequence is an ordering, not a dependency. Nothing can say framing waits on the inspection. |
| **Assigned Team** | Tasks have an assignee; milestones do not. |

None is a bug — the build is at the phase §0 allows. Listing them so the gap is
a decision rather than a discovery.

---

## 4 · Tasks — no defects found

`Task` matches §6.3 and `TASK_STATUSES` is transcribed verbatim, all nine
values. The provisional set is realistic: trades named, a PM note written the
way a PM actually writes one ("shim before you fasten — that wall is out about
6mm at the top"), and `assignedAt` / `seenAt` distinct so the unseen badge has
something true to count.

Two observations, neither a fault:

- **`assignedTo` is a name, not an id.** §3.6 says never key a cross-system link
  off a name. This is display-only today and does not join anything, so it is
  fine — but it must not become the link when tasks sync to GHL.
- **Task status is validated nowhere either.** Same shape as the milestone
  problem, but here the enum exists, so this one is fixable now rather than
  needing a decision. `setTaskStatus(status: string)` should take a
  `TaskStatus`.

---

## 5 · The provisional milestone sets themselves

Three projects' worth in fixtures, plus a seeded set in `hub_milestones`.

**Kitchen (`BSP-2026-000184`)** — Demolition → Rough Plumbing & Electrical →
Cabinet Installation → Countertop Template & Fabrication → Backsplash & Paint →
Final Walkthrough. Correct order, and correct in the detail that matters:
countertop templating comes *after* cabinets are set, which is the real
dependency and the one most often got wrong on paper.

**Addition (`BSP-2026-000177`)** — Foundation → Framing → Framing Inspection.
Right, though inspection as a milestone rather than a task is a choice worth
being deliberate about: it is a gate, and gates are what `Dependency` is for.

**Bathroom (`BSP-2026-000191`)** — Fixture Procurement → Demolition. Procurement
before demolition is deliberate and correct for a bathroom, where a wrong-colour
fixture arriving late stops everything.

**Gap:** every fixture milestone is `clientVisible: true`. Only the seeded set
has an internal one. A provisional set where everything is published does not
exercise the switch, and the switch is the privacy model.

---

## 6 · Not reviewed

**The live `hub_milestones` and `hub_tasks` rows.** Both Supabase hosts became
unreachable from this machine partway through (`UND_ERR_CONNECT_TIMEOUT` on
BuildSuite and the Hub alike, after both had answered minutes earlier), so the
seven milestone and task rows were counted but not read.

Everything above is from the code, the migrations and the seed script, which is
where the bug was anyway. The row-level pass is outstanding: re-run
`node scripts/seed-test-case.mjs --check` or read the tables directly once the
network is back.
