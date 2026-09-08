# BuildSuite — what is blocking the Hub, and the test record we need

**To:** Sing · **From:** Dale · **Date:** 2026-09-08
**Everything below was measured against the live database today, not remembered.**

---

## The short version

The Hub is built. The pilot is now a **data** problem, and almost all of it sits
on the BuildSuite side.

**One thing unblocks the most: a real signed project we can actually read.**
Right now there is not one, and everything downstream — the handoff, the
invoice, the homeowner login — has never run on real signed data because there
is nothing to run it against.

Five asks, in priority order:

| # | Ask | Blocks |
|---|---|---|
| 1 | A signed project we can read (see the test record spec) | Everything |
| 2 | A real contract amount on a signed proposal | The whole invoice flow |
| 3 | Confirm `proposals.signature_status` is the signature of record | Correctness everywhere |
| 4 | Confirm which of `content` / `sections` is canonical going forward | The schedule parser |
| 5 | The GHL auto-stamp writing `project_code` onto every record | The handoff join |

---

## Blocker 1 — the four signed proposals are orphaned

This is the big one.

```
proposals with signature_status = SIGNED     4
…and every one points at project_id          87a42c43-0f0e-4d2b-b07d-65311aa04d29
that project, fetched directly               [] — zero rows
projects visible to our key                  103
```

**It is not a soft delete and it is not our key.** We checked: soft-deleted
projects *are* readable by us (there are 2, and we can see both). `87a42c43`
does not come back even when we query specifically for deleted rows. And the
four proposals themselves are alive — `deleted_at` is null on all four.

So the row is gone from `projects` while four proposals still reference it.

**Why it blocks everything.** The Hub keys work to the project. No project means
no job to hand off, nothing to invoice against, and no portal for a homeowner to
sign in to. The signature is real and sits on the proposal; the job it belongs
to cannot be read.

**What would unblock it — either is fine:**

- **(a)** Tell us what happened to `87a42c43`. If it was deleted in error and
  can come back, that is the fastest path — it already has four signed
  proposals attached.
- **(b)** Create the test record below. **We would prefer this**: a clean row
  we both understand beats a resurrected one whose history we cannot see.

**Worth knowing either way:** if a project can be deleted while its proposals
survive, this will happen again with a real customer's signed contract. A
foreign key, or a soft delete on both sides, would stop it.

---

## Blocker 2 — there is no contract amount anywhere

The invoice flow's whole job is to turn a payment schedule line into a figure.
There is currently nothing to multiply by.

```
projects.exact_budget populated                0 of 103
proposals.total populated                      8 of 46
proposals.total on a SIGNED proposal           0 of 4
```

`projects.budget_band` and `proposals.price` are **bands** — `"$2,000 - $5,000"`
— not figures. A band cannot become an invoice.

**What this means today.** For every signed proposal our deposit draft comes out
as: percent 50, no title, no amount. The contractor has to type the number in.
That is a deliberate design — we never invent money, and blank is honest where
zero would be dangerous — but it means the automatic half of Chris's flow cannot
run.

**The ask:** a real numeric contract total on the signed proposal, in
`proposals.total` (or tell us the column you would rather we read). One figure
on one row is enough to prove the whole chain.

---

## Blocker 3 — please confirm the signature of record

```
deals.signature_signed_at populated      0 of 183
proposals.signature_status = SIGNED      4 of 46
```

We measured `deals.signature_signed_at` for three days and reported **"0 signed,
182 deals"** to the client. It was wrong — BuildSuite never populates that
column, and the signature lives on `proposals`. You caught this. It has since
been repeated in a handoff document written by someone else, along with the
conclusion *"the funnel is the constraint, not the software"* — which was built
on an empty column.

**The ask is one sentence from you:** is `proposals.signature_status` the
signature of record, permanently? If yes we will write it into the architecture
so nobody measures the other one again. If `deals.signature_signed_at` is meant
to be filled and simply is not, that is worth knowing too.

---

## Blocker 4 — the payment schedule has two homes

```
proposals.content   39 of 46   markdown prose, includes all 4 signed
proposals.sections   8 of 46   structured JSON under `payment_schedule`
neither                8 of 46
```

We now parse both — structured preferred where it exists, markdown otherwise,
which gets us to 38 of 46. That works, but it is two readers for one concept and
it will drift.

Three markdown shapes occur in real rows, and we handle all three:

```
- **50%** upon acceptance of this contract and project scheduling
- Contract Signing (10%)
- **Contract Signing & Scheduling** (30% — $1,773.75)
```

Only the third states a title, a percent AND an amount.

**The ask:** which one is canonical going forward? If `sections` is the future,
we will make it primary and treat markdown as legacy. If `content` is, we will
stop reading `sections`. Either is fine — we would rather not maintain both
indefinitely.

---

## Blocker 5 — the join key, and the GHL stamp

Your confirmation of the two code shapes landed in our code this week:

```
BSA-044        feed and client projects, one Alliance-wide series
BSA-ASJF-006   contractor-created, letters the contractor picks
```

That corrected a real bug on our side: we had inferred `BSA-` plus exactly three
digits from the 50 codes that exist today. That pattern rejected every
contractor-created code, and would have rejected the feed series itself at
`BSA-1000`. It was also in our homeowner-login check, so a homeowner on a
contractor-created project could never have signed in. Both are fixed.

Current state:

```
project_code present     50 of 103   all BSA-NNN, no duplicates
pending (null)           53 of 103   normal — awaiting the contractor's letters
malformed                 0
```

**Remaining ask:** the auto handoff-stamp that writes `project_code` onto every
GoHighLevel record. You set one record by hand (`BSA-051`); until it is
automatic, the join only works for that one.

We are **not** asking you to backfill the 53 nulls. We now treat null as
*pending*, not missing, and the Hub renders it that way.

---

## The test record we need

One project, one proposal, wired the way a real signed job would be. This is
what lets us prove the whole chain end to end.

### The project row

| Column | Value | Why we need it |
|---|---|---|
| `project_code` | any real code, e.g. `BSA-052` | The join key. Handoff, and the homeowner's second factor |
| `client_email` | a real address you control | Second factor, and where the sign-in link goes |
| `ghl_contact_id` | a real GHL contact id | The client portal resolves a homeowner by this |
| `title` | anything recognisable, e.g. `[HUB TEST] Kitchen remodel` | So nobody mistakes it for a customer job |
| `client_name` | anything | Shown on the invoice |
| `street_address`, `city`, `state`, `postal_code` | anything | The field crew sees the address |
| `status` | `active` | So it appears in the working set |
| `auth_profile_id` | Ralph's, `7726102a-8e13-4006-889d-d68bc1cccd40` | **Load-bearing** — every Hub read filters on this. A project without it is visible to nobody |
| `start_date`, `end_date` | anything | Schedule screen |
| `deleted_at` | null | — |

**Please label it clearly as a test.** We seeded our own Hub fixtures with
`[TEST CASE]` in the name and it has saved confusion more than once.

### The proposal row

| Column | Value | Why |
|---|---|---|
| `project_id` | the project above | The link that is currently broken |
| `contractor_id` | Ralph / AFC, `5dd312bd-0b95-45af-be7b-c19a14eff103` | Proposals filter on this, not on `auth_profile_id` |
| `signature_status` | `SIGNED` | The trigger for the whole invoice flow |
| `signature_signed_at` | a timestamp | So we can order by it |
| **`total`** | **a real number, e.g. `24500.00`** | **The one field that currently blocks invoicing** |
| `content` **or** `sections` | a payment schedule (below) | What the invoice is composed from |
| `status` | `accepted` | Matches the other signed rows |

### The payment schedule

Either shape works. If you have a choice, **the structured one is better** —
it states its figures where the markdown makes us infer them:

```json
{
  "payment_schedule": [
    { "milestone": "Contract Signing & Scheduling", "percentage": 30, "amount": 7350.00,
      "trigger": "Upon signing and project scheduling" },
    { "milestone": "Rough-In Completion",           "percentage": 40, "amount": 9800.00,
      "trigger": "On completion of rough-in" },
    { "milestone": "Final Completion",              "percentage": 30, "amount": 7350.00,
      "trigger": "On punch list sign-off" }
  ]
}
```

Percentages summing to 100 and amounts summing to `total` is what we would
expect; if they do not, we surface the mismatch to the contractor rather than
silently correcting it, so an inconsistent one is also a useful test.

### What we will do with it, so you can check our work

1. The project appears in the contractor's list, scoped to Ralph
2. The handoff builds a valid payload keyed on `project_code`
3. Three invoice drafts appear, with amounts **stated** rather than typed in
4. The homeowner signs in with `client_email` + `BSA-052` and sees their portal
5. A field member assigned to it can file an update from site

Any step that fails is ours, and we will say so.

---

## Things that are NOT blockers — please don't spend time on these

- **`superintendent` / field-team columns.** There is no such column on
  `projects` and we are not asking for one. Crew assignment is the Hub's job and
  it is built — the contractor ticks projects per person on the Team screen. We
  briefly keyed off a name field and it was a mistake; ids only now.
- **The 53 null `project_code`s.** Pending, not missing. Handled.
- **`client_phone`.** Populated on 81 of 103; we do not read it.
- **Backfilling anything historical.** One good row beats a hundred repaired
  ones. We only need the pilot to be real.

---

## Appendix — how everything above was measured

Read-only, against the live database, on 2026-09-08. No writes.

```
projects           103 rows
  project_code      50    client_email 95    ghl_contact_id 50
  exact_budget       0    start_date   45    status=active  44
  soft-deleted       2    (both readable by our key)

proposals           46 rows
  SIGNED             4    total 8    subtotal 8
  SIGNED with total  0
  content           39    sections 8

deals              183 rows
  signature_signed_at  0
  sent_to_crm_at       2
```

Happy to re-run any of it, or to walk the numbers with you live if that is
faster.
