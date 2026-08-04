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

## 3. Test B — live data reachable from our own front-end

> **Revised 2026-07-31 (decision D-001).** The original Test B proved AI Studio
> could bind live per-client data. We are no longer using AI Studio, so that
> version of the test proves nothing. What still needs proving is the same
> underlying risk — *can a client-facing surface read live, per-contact project
> data out of GHL* — just through the API instead of through AI Studio.

**Effort:** ~1 hour · **Proves:** the data chain our front-end depends on

Every client-facing screen in Weeks 2–3 assumes this works.

### Steps

1. In the build sub-account, create **one** record on the test object:

   | Field | Value |
   |---|---|
   | Project Name | `Johnson Kitchen Remodel` |
   | BuildSuite Project ID | `BSP-TEST-001` |
   | Progress Percentage | `62` |
   | Project Stage | `In Progress` |
   | Client Visible | Yes |

2. Using the build sub-account's integration token, **read that record back over
   the GHL API** — a custom-object record fetch, looked up by
   `BuildSuite Project ID`. curl or Postman is fine; no app needed.
3. Confirm the response contains **`Progress Percentage` = 62**.
4. Change the record to **70** in the GHL UI.
5. Re-run the same call and confirm it returns **70**.

### Record while you're in there

Not pass/fail, but each one is a Week 2 design decision that costs a day if it's
discovered late:

- [ ] **Can records be queried by a custom field** (`BuildSuite Project ID`), or
      only by GHL's internal record ID? The whole model assumes the former (§3.6).
- [ ] **Can records be filtered by associated contact** in one call, or does it
      take a fetch-then-filter round trip? Phase 4 needs per-contact filtering,
      and this decides whether that's one query or N.
- [ ] **What are the rate limits** on the custom-object endpoints? The Portfolio
      Overview lists many projects at once.
- [ ] **How is a portal-authenticated contact identified server-side?** Can our
      app verify who is signed in to GHL's native portal, or do we run our own
      session against a GHL identity? This is the largest remaining unknown in
      Phase 4 and it should not wait until week 2.

**Paste the raw JSON response somewhere I can see it.** It's the fastest way to
pin the actual field shapes, and it saves a round of guessing at the API client.

### Result

- **Pass →** proceed to Phase 1.
- **Fail → STOP.** Do not build any client-facing screen. If project data can't
  be read out of GHL by shared ID and filtered per contact, the whole
  one-record-three-views model needs rethinking, and no amount of front-end work
  helps. This is the schedule-killer.

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
| **Test B** live data over the GHL API | | | |

**Gate:** both tests pass → Phase 1 begins (Day 2). Otherwise apply the fallback
above and update KICKOFF.md before any building starts.

---

## 5. What Phase 0 deliberately does not do

Not building the full nine-object model, not building the pipeline, not building
screens. Two tests, one throwaway object, one record. The whole point is to spend
an hour before spending three weeks (§3.7, ship slices).
