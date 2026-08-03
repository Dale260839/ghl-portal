# Phase 0 — Validation Sprint (go / no-go)

> **Owner:** Chris + Pat · **Run:** Day 1, Mon 2026-08-03 · **Total effort:** ~1h15
> **Source:** ARCHITECTURE.md §15. That file wins on any conflict with this one.
> **Nothing in Phase 1+ starts until both tests pass.**

This is a runbook, not a summary. Work top to bottom and record the result in
§4 as you go — the fallbacks below change the shape of Weeks 2 and 3, so a
half-remembered "I think it worked" is worse than a failure.

---

## 1. Prerequisite checks — do these FIRST

These can block everything, and they are the cheapest thing on the page. Confirm
on the **actual contractor sub-account tier**, not the agency view — the agency
view shows features the sub-account tier may not have.

- [ ] **P1.** GHL **Custom Objects** available on the contractor sub-account tier
- [ ] **P2.** Native **GHL Client Portal** available on that same tier
- [ ] **P3.** Snapshots on that tier can carry **custom objects, their fields, and
      their associations**
- [ ] **P4.** Master build sub-account `BuildSuite™ Development / Template` exists
      and is clean — no live client data (§2)
- [ ] **P5.** Throwaway **test contractor sub-account** provisioned to receive the
      snapshot
- [ ] **P6.** Integration token issued for the build sub-account (owner: Sing)

**Any of P1–P3 fails → stop and escalate.** This is decision D4 in §16, and it
is not something to work around quietly — it re-prices the entire project.

---

## 2. Test A — snapshot transfer

**Effort:** ~10 minutes · **Proves:** the per-contractor rollout model (Phase 6)

The entire distribution strategy rides on snapshots carrying custom objects. If
they don't, we need a per-account setup script — and we want that on day one,
not in week three.

### Steps

1. In the **master build sub-account**, create Custom Object
   **`BuildSuite Test Project`** with exactly these fields:

   | Field | Type |
   |---|---|
   | Project Name | text |
   | BuildSuite Project ID | text |
   | Progress Percentage | number (percent) |
   | Project Stage | select |
   | Client Visible | checkbox |

2. Add **one association → Contact**.
3. Create / update the snapshot.
4. Push the snapshot into the **test contractor sub-account**.
5. In the test sub-account, confirm each of these arrived intact:
   - [ ] the object exists
   - [ ] all five fields exist, with the right types
   - [ ] the Contact association exists
   - [ ] **a workflow can reference the transferred object** (open the workflow
         builder and confirm the object appears as a trigger/action target — this
         is the step most likely to quietly fail)

### Result

- **Pass →** Phase 6 stays as written: one snapshot, distributed per sub-account.
- **Fail →** Phase 6 becomes a **per-account setup script / manual deployment
  checklist** driven by the GHL API (§15). Adds roughly a day to Week 3. Record
  *which* part failed — object, fields, associations, or workflow visibility —
  because a partial transfer means a partial script, not a full one.

---

## 3. Test B — AI Studio live data

**Effort:** ~1 hour · **Proves:** the only piece of the plan nobody has tested

This is the difference between a visual demo and a real portal. Every
client-facing screen in Weeks 2–3 assumes this works.

### Steps

1. In the build sub-account, create **one** record on the test object:

   | Field | Value |
   |---|---|
   | Project Name | `Johnson Kitchen Remodel` |
   | BuildSuite Project ID | `BSP-TEST-001` |
   | Progress Percentage | `62` |
   | Project Stage | `In Progress` |
   | Client Visible | Yes |

2. Wire **`Progress Percentage`** — one field, nothing else — into the AI Studio
   prototype dashboard.
3. Confirm the prototype displays **62**.
4. Change the record to **70**.
5. Confirm the dashboard reflects **70**.

### Record while you're in there

These aren't pass/fail, but they decide open question **F1** in KICKOFF.md §5
and answering them now saves a day later:

- [ ] How did the value get in — native data binding, an API call, or something
      manual?
- [ ] Did step 5 need a refresh, or did it update on its own?
- [ ] Can the binding **filter by the signed-in contact**, or does it just fetch
      the record? (Phase 4 needs filtering, and this is where you'd find out it
      can't.)

### Result

- **Pass →** proceed to Phase 1.
- **Fail → STOP.** Do not build any client-facing screen. Re-plan the live-data
  layer first; this is the schedule-killer, and the fallback (a custom front-end
  against the GHL API) re-prices Weeks 2–3.

---

## 4. Record the outcome

| Check | Result | Date | Notes |
|---|---|---|---|
| P1 Custom Objects on tier | | | |
| P2 Native Client Portal on tier | | | |
| P3 Snapshots carry objects/fields/associations | | | |
| P4 Build sub-account clean | | | |
| P5 Test sub-account provisioned | | | |
| P6 Integration token issued | | | |
| **Test A** snapshot transfer | | | |
| **Test B** AI Studio live data | | | |

**Gate:** both tests pass → Phase 1 begins (Day 2). Otherwise apply the fallback
above and update KICKOFF.md before any building starts.

---

## 5. What Phase 0 deliberately does not do

Not building the full nine-object model, not building the pipeline, not building
screens. Two tests, one throwaway object, one record. The whole point is to spend
an hour before spending three weeks (§3.7, ship slices).
