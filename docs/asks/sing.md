# Four things, Sing — one of them unblocks everything else

**From:** Dale · **Date:** 2026-08-28 · **Reading time:** 4 minutes

All four are small. They are ordered by what they unblock, not by effort.

---

## 1. Run `supabase/migrations/0001_hub_tables.sql`

**This is the one that matters most, and it is the shortest.**

Nine tables. **Create-only** — no `ALTER`, no `DROP`, nothing touching an
existing table. I wrote it against the live-system guardrails deliberately, and
you can read the whole file in two minutes to confirm that.

**Why it is blocking more than it looks.** BuildSuite holds projects, clients and
dates. It does not hold field updates, milestones, tasks, documents or photos —
those are ours, and they have nowhere to live. So right now:

- the field-update review queue is empty
- the client portal renders its empty state on every screen
- the contractor dashboard shows a dash for contract value and outstanding balance

None of that is a bug. The code paths are written and tested; they have no store.
The product's central loop — crew submits, PM approves and publishes, homeowner
sees it — cannot be demonstrated to a client until this runs.

It needs the service-role key, which is why it is yours and not mine.

---

## 2. The shared key — you are blocked on Chris, not on me

Do not start the handoff until Chris answers, because the answer changes the
implementation.

The full spec is **`docs/HANDOFF-CONTRACT.md`** — exact field names, an example
payload, and the validation rules. Short version of the problem:

The contract requires `buildsuite_project_id` to match `BSP-YYYY-NNNNNN`. Nothing
in BuildSuite is in that format: `projects.id` is a UUID (101/101),
`projects.project_code` is `BSA-NNN` (48/101), `award_code` is empty. **A handoff
sent today would be rejected for every project in the database.**

Two options are on Chris's page. Either way, the Hub side is finished — once a
valid payload arrives, WF1 creates 17 records with no further work from us, and
it is idempotent, so a resent proposal or a retried webhook does not duplicate
anything.

---

## 3. `contract_amount` — where does the signed total live?

The handoff needs a real number. BuildSuite has `budget_range`, which is a band,
and it holds **two vocabularies in the same column**:

- 101 of 182 deals use tokens — `5k_10k`, `under_5k`, `100k_plus`
- 37 are already written out — `$15,000 - $50,000`, `$250,000+`
- 22 are empty

A band is not an amount, and taking one end of it puts a wrong number on a
contract. `projects.exact_budget` exists but was null on every row I sampled.

**The ask:** point me at the column holding the signed proposal total, or confirm
it needs adding. If it is on `proposals`, naming the column is enough.

---

## 4. Confirm `signature_signed_at` means signed

The Hub's definition of won is `signature_signed_at` **or** `sent_to_crm_at`,
whichever lands first — the signature is captured before the handoff fires, so
either alone is enough.

I cannot verify this from data: the column is empty on all 182 rows, so no sample
can prove it. It is one line in `deals.ts` and it is marked as needing your
confirmation.

It decides whether the signed-only project filter is correct. That filter is
built and tested and ships **off** — switching it on today would take Alliance
from 9 projects to 1.

---

## Two things you should know about how I have been working

**Every read is tenant-scoped, and nothing writes.** The Hub reads `projects` and
`deals` with `auth_profile_id` filtering, using the publishable key. I do not
select `access_token`, `client_email`, `client_phone`, `photo_urls`,
`photo_analysis`, `metadata` or `signed_pdf_url` — the key permits them and the
narrowest select is our half of that exposure. A test fails if anyone widens it.

**`deals.auth_profile_id` is populated on roughly half the table.** So any
per-contractor count undercounts, and the Pipeline screen says so on itself
rather than presenting the number as complete. If that column is meant to be
universal, it is worth knowing why it is not.

---

## If you want to check my work

```bash
npm run rehearse          # replays a signed deal through the whole chain
npm run rehearse -- --live   # same, using a real deal from BuildSuite
```

Read-only by construction — there is deliberately no flag that performs the
handoff. It prints exactly where the chain stops and who owns that step.
