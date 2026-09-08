# The two items — what I can and cannot see

**To:** Sing · **From:** Dale · **Date:** 2026-09-09
**All figures measured live, read-only, minutes before writing this.**

Short version: **both things exist and are populated on `proposals`. Neither is
on `projects`.** I think that is the whole disagreement — you may have done both
on the table where the data actually lives, and the original ask named the wrong
one.

Nothing here is blocked. Our code reads both from `proposals` and it works. The
only open question is whether you still want them duplicated onto `projects`.

---

## 1 · The signed PDF link

### On `proposals` — there, and populated

```
proposals.signed_pdf_url        5 of 48 rows
…and 5 of the 6 SIGNED rows have one
```

Two hosts in use, both fine:

```
Supabase   .../storage/v1/object/public/proposals/<id>/signed_*.pdf
GHL        services.leadconnectorhq.com/proposals/document/public/download-pdf?...
```

**We are reading it as of today.** It now shows as a "Signed contract" link on
the engagement list and on each invoice card.

### On `projects` — not there

`projects` has **55 columns**. The only document-shaped ones are:

```
documents                        jsonb — empty [] on 103 of 105
sow_pdf_url                      6 of 105
contractor_note_recommendation   text
```

I checked this two ways, because I have been wrong about a missing column
before by matching on an error message instead of its code:

- Sampled 60 rows and unioned every key — 55 columns, no signed-PDF field.
- Asked PostgREST for twelve plausible names directly (`signed_pdf_link`,
  `signed_pdf_url`, `signed_document_url`, `signed_contract_url`,
  `contract_pdf_url`, `signature_pdf_url`, …). **Every one returned `42703`,
  "column does not exist"** — not `42501`, which is what a column that exists
  but has no `SELECT` grant returns.

So this is not our key lacking a privilege. The column is not on the table.

I also looked inside the jsonb in case it was nested there. `documents[]` has
`file_name`, `file_type`, `url` — and is `[]` on both signed test projects.

### What I would suggest

**Leave it on `proposals`.** The signed PDF belongs to the proposal that was
signed, the join to `projects` already exists, and a copy on `projects` is a
second thing to keep in sync — one more place to be stale when a contract is
re-signed. We are already reading it successfully.

If you would rather it were denormalised onto `projects`, say so and I will read
it from there instead. It is your schema; I just do not want you building a
column we do not need.

---

## 2 · Exact pricing instead of a range

### On `proposals` — resolved, and thank you

```
proposals.total        10 of 48   numeric
proposals.price        33 of 48   a single exact number, e.g. "24500.00"
                       15 of 48   still a band, e.g. "$2,000 - $5,000"
                        0         anything else
```

This is genuinely fixed from our side. `price` now holds a real figure on 33
rows, and we parse it — **but only when the whole string is one number.** A band
contains a hyphen and cannot match, so it falls through rather than being read
as its low end, which would quote a homeowner $2,000 for a job that might cost
$5,000.

**Exact-price coverage in the Hub went from 10 of 48 to 33.** The remaining 15
render as "estimated range" rather than as a figure.

### On `projects` — the column exists but is empty

This one is different from item 1: the column IS there.

```
projects.exact_budget      0 of 105     ← exists, never populated
projects.budget_band     105 of 105     ← the range, on every row
```

So `exact_budget` has been sitting there unused since before I started
measuring. If the exact figure is meant to land there too, nothing is writing
it. If it is not — and the proposal is the right home for a contract value —
then it is a column we should both ignore, and I will stop reporting it as a
gap.

**Notably, both signed test projects still carry only a band:**

```
BSA-052       [HUB TEST] Kitchen remodel   budget_band "$10,000 - $50,000"   exact_budget NULL
BSA-APS-001   Test Project                 budget_band "$15,000 - $50,000"   exact_budget NULL
```

The exact 24,500 for BSA-052 is on its **proposal**, not its project — which is
where we read it from, and it works.

---

## What is actually working now, thanks to your test record

Your `[HUB TEST] Kitchen remodel` landed exactly to spec, and it unblocked the
thing that had been stuck for a week. Run through our real read path today:

```
projects visible to Ralph       33
SIGNED and readable              1        (it was 0 every day before this)

[HUB TEST] Kitchen remodel · BSA-052 · contract $24,500 from proposals.total
  1. Contract Signing & Scheduling   30%   $7,350   stated
  2. Rough-In Completion             40%   $9,800   stated
  3. Final Completion                30%   $7,350   stated
```

All three amounts **stated** rather than needing a contractor to type them, and
they sum to exactly the contract total. That is the first time the invoice
screen has produced a real draft from real data.

Two small things on that record, if you have a minute:

- **No `signed_pdf_url` on its proposal**, so the signed-contract link is the
  one part of the chain still untested end to end.
- Its payment schedule is in `sections` rather than `content`. That is fine —
  we read both — but it did expose a real bug on our side, which is now fixed:
  the invoice screen had been reading `content` only, so it would have shown
  your record zero lines and looked like our parser was broken.

---

## The one thing still blocking a pilot

`87a42c43`, the project the four older signed proposals point at, is still
absent from `projects` — it returns zero rows while 105 others are readable, and
it is not soft-deleted (soft-deleted rows ARE readable by us; there are two and
we can see both).

Not urgent any more, since your test record gives us a working path. But those
four signed proposals are orphaned, and if a project can be deleted while its
proposals survive, it will happen again to a real customer's signed contract.
Worth a foreign key.
