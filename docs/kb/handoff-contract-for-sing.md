# Send-to-CRM handoff contract

**For:** Sing · **From:** Dale · **Written:** 2026-08-28
**Status: PROPOSED.** One decision inside this is not yet confirmed by Chris — see §1.
Everything else is measured against the live database, not assumed.

---

## 0. What this is

When a proposal is signed, BuildSuite fires **Send-to-CRM**. That writes a payload onto the
GoHighLevel Contact, GoHighLevel notifies the Hub by webhook, and **WF1 New Project Setup**
seeds the project: milestones, default tasks, progress, client portal access.

All of that exists and is tested. **It has never run**, because no deal has ever been signed
(`docs/kb/two-system-model.md`: 182 deals, 0 signatures). This document is the exact shape
BuildSuite must send so that the first signature does not also become the first debugging
session.

The Hub does **not** build this payload. BuildSuite does. We only validate it.

---

## 1. The one open decision: the shared key

**We need one ID that links a project across both systems, and one side that generates it.**

Three answers exist in the documents, and D4 §6 contradicts itself. Measured today:

| Candidate | State in the live database |
|---|---|
| `BSP-YYYY-NNNNNN` (ARCHITECTURE §3.6, D1) | **No such column, no such value anywhere.** But the §8.2 contract requires this format, so no real row could pass it today. |
| `ghl_opportunity_id` (D4 §6) | Column exists on every row. **Empty on all 182.** |
| `projects.id` (BuildSuite's own row id) | Real and populated. Currently the Hub's stopgap. |

**My proposal, pending Chris:** **BuildSuite generates it; GoHighLevel stores and copies it.**

Reasoning: it is the only option where the key exists *before* the record it identifies.
GoHighLevel's opportunity id is created during the handoff, so keying on it means the first
message has nothing to key on.

**Please do not start on this until Chris confirms.** In our code the choice lives in exactly
one file (`apps/web/src/lib/handoff/shared-key.ts`) so a reversal is a one-line change. A test
fails if that flag is flipped without a deliberate update.

**Hard rule either way (§3.6, D4 §10):** the key goes in a **dedicated field on both sides**.
Never a job title, client name, or address. A rename would break the link silently and show the
wrong data on a job site.

---

## 2. The payload

Written onto the GoHighLevel Contact at Send-to-CRM. Field names are **snake_case exactly as
below** — they are a verbatim contract, not display names.

```json
{
  "buildsuite_project_id": "BSP-2026-000184",
  "project_name": "Dana Johnson — Kitchen Remodel",
  "project_address": "1214 Cedar Lane, Spokane WA 99201",
  "contract_amount": 68400,
  "client": {
    "name": "Dana Johnson",
    "email": "dana@example.com",
    "phone": "509-555-0134"
  }
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `buildsuite_project_id` | string | yes | The shared key from §1. Must match `BSP-YYYY-NNNNNN` under the current contract. Immutable once issued. |
| `project_name` | string | yes | Non-empty. |
| `project_address` | string | yes | Non-empty. |
| `contract_amount` | number | yes | Finite. Currency amount, not a band. |
| `client.name` | string | yes | Non-empty. |
| `client.email` | string | yes | Non-empty. |
| `client.phone` | string | yes | Non-empty. |

**WF1 refuses the whole payload if any of these fail**, and reports every problem at once rather
than the first. It does not invent an ID and it does not partially create a project — a record
that cannot be matched back to BuildSuite is worse than no record.

No other operational data is expected from BuildSuite (§1.2). Milestones, tasks, updates, change
orders and invoices are created after handoff, on the GoHighLevel side.

---

## 3. The five fields we cannot supply for you

We read BuildSuite's `deals` table. Measured against it, a deal row **cannot** produce a valid
payload on its own. These must come from BuildSuite:

| Missing | Why |
|---|---|
| `buildsuite_project_id` | §1. No column holds it today. |
| `project_address` | Not on `deals`. |
| `contract_amount` | `deals` carries a **budget range**, not an amount. |
| `client.email` | **We deliberately do not read it** — see below. |
| `client.phone` | Same. |

**On the two client fields:** our reader intentionally excludes `client_email` and `client_phone`
from its column list. Those are readable with a publishable key, so the narrowest possible select
is our half of limiting that exposure. They still have to reach GoHighLevel — **directly from
BuildSuite at handoff, not routed through us.**

---

## 4. What happens on our side when it fires

```
BuildSuite: signature captured → sent_to_crm_at set → Send-to-CRM fires
   → GoHighLevel Contact carries the payload above
   → GoHighLevel webhook → the Hub  (signature verified, replay rejected)
   → WF1: create project, associate contact + opportunity, seed 7 milestones
          and default tasks, progress 10%, prepare client portal access
   → the project appears on the contractor dashboard as signed work
```

**Idempotent.** A re-sent proposal or a retried webhook delivery must not seed milestones twice.
WF1 detects an existing project for the same key and records the event instead of re-seeding.
Tested.

**Missing credentials fail loudly, not silently.** Without the webhook secret the receiver
refuses everything rather than trusting an unverifiable payload, and logs the reason.

---

## 5. Two questions back to you

1. **Is `signature_signed_at` the right column for "won"?** It is empty on all 182 rows, so no
   sample can prove it. We currently treat *either* a captured signature *or* `sent_to_crm_at`
   as signed work, which means 2 rows count as won without a signature. If there is a different
   column that actually means won, tell us and it is a one-line change.

2. **`deals.auth_profile_id` is populated on about 53% of rows.** Tenant-scoped counts therefore
   undercount, and some of a contractor's deals are invisible to them. Is that expected, or a
   gap worth backfilling?

---

## 6. How to test it without a real signature

We have a replay harness: `apps/web/src/lib/handoff/replay.ts`. Hand it a deal plus the fields
above and it walks the whole chain, reporting which step it stops at.

Run against a signed deal with no shared key — the situation today — it reports:

```
PASS  deal_is_signed: signature captured
STOP  shared_key_present: no buildsuite_project_id on the deal
                          (C-3 undecided, and the column is empty on every row)
chain stopped at shared_key_present
```

With all five fields supplied it completes and plans the full WF1 effect list. So the moment
§1 is decided and BuildSuite sends the fields in §2, this is provable before a real deal is at
stake.
