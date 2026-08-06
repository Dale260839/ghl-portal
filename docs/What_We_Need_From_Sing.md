# What We Need From Sing — GHL Platform Integration

**From:** Dale
**To:** Sing (BuildSuite)
**Date:** 2026-08-04
**Purpose:** Everything blocked on your side, in priority order, so nothing waits
on a second round of questions.

---

## 0. Where we are, so you know what you're unblocking

The three experiences are built and running — Contractor Dashboard, Field
Interface, Client Portal — plus WF1 and WF2 as code, the GHL API client, and the
§9.1 gate enforced at the data layer. 88 tests green.

All of it runs on **fixtures**. The data layer sits behind one interface, so
swapping fixtures for live GHL data changes no screen. What's below is what turns
the demo into the product.

Nothing here is urgent-as-in-panic. It's urgent-as-in-everything-downstream-waits.

---

## 1. The asks, in priority order

### 1.1 GHL integration token for the build sub-account — **blocks everything**

ARCHITECTURE §2 has you owning this. Without it the app can't read a single real
record.

| What | Notes |
|---|---|
| `GHL_API_BASE_URL` | Presumably `https://services.leadconnectorhq.com` — confirm |
| `GHL_API_VERSION` | The `Version` header date GHL wants (e.g. `2021-07-28`) |
| `GHL_LOCATION_ID` | The build sub-account's ID |
| `GHL_PRIVATE_INTEGRATION_TOKEN` | Private Integration token, scoped to that sub-account |
| *or* OAuth trio | `CLIENT_ID` / `CLIENT_SECRET` / `REFRESH_TOKEN` if a PI token isn't an option — tell us which and we'll wire that path instead |

**Scopes needed:** read on custom objects and their records, read on contacts,
read on opportunities. Write only if you want us running WF1/WF2 against live
records rather than dry-running them — say the word either way.

Send them however you normally would — please **not** in a chat thread.

### 1.2 The BuildSuite API for the hourly stage sync-back — **blocks §8.3**

We decided (D-004) the sync-back writes through your existing API rather than
touching a database directly. We need:

| What | Notes |
|---|---|
| `BUILDSUITE_API_BASE_URL` | |
| `BUILDSUITE_API_KEY` | And which header carries it |
| Endpoint list | Just the ones relevant to project stage |

**The specific question:** which endpoint accepts a stage update keyed by
`buildsuite_project_id`, and **is it idempotent under retry?**

That last part isn't pedantry. The job runs hourly across every project and will
retry on 5xx. If calling it twice with the same stage does something other than
nothing, we design it differently — dedupe keys, a run log, conditional writes.
Cheaper to know now.

Also useful: rate limits, and whether there's a staging environment we can point
at while testing, so we're not hammering production on an hourly loop.

### 1.3 The Send-to-CRM handoff extension — **blocks the end-to-end chain**

Your ~1 day of work from §8.2. We've built the receiving side already and it
validates against the contract below.

**What we need beyond the code itself:**

1. **One real captured payload**, verbatim JSON, exactly as it lands on the
   Contact. This is the highest-value thing you can send — our validator is
   written against §8.2 as specified, and a real sample is what proves the spec
   matches reality. You offered same-day turnaround on exactly this kind of ask
   in your last doc, so I'm taking you up on it.
2. **Where the fields land** — Contact custom fields? What are the field keys?
   Our mapper currently assumes snake_case matching the §8.2 names.
3. **When it fires** — on proposal signature, on Send to CRM, both?
4. **What happens on a re-send.** If a proposal is re-sent or the call retries,
   does it write the same `buildsuite_project_id` again? Our WF1 is idempotent
   and treats a repeat as "already exists, skip seeding" — confirm that's the
   right read.

### 1.4 The BuildSuite Project ID — **confirm, don't assume**

Everything keys off this (§5, §3.6). Four things to confirm:

- **You mint it**, not GHL — correct?
- Format is `BSP-YYYY-NNNNNN`, e.g. `BSP-2026-000184`. Our validator **rejects**
  anything else rather than defaulting, so a format drift fails loudly.
- **Unique and immutable** for the life of the project.
- What it looks like in any sandbox/test data, so our fixtures match.

---

## 2. The contract we're building against

You said last time: *"Tell me the exact field names you want and I will match
them."* Taking that literally — here is exactly what we validate.

### `§8.2` handoff payload, as we parse it today

```jsonc
{
  "buildsuite_project_id": "BSP-2026-000184",  // required · unique · immutable
  "project_name": "Johnson Kitchen Remodel",   // required · non-empty
  "project_address": "1400 Broadway, San Antonio, TX",  // required · non-empty
  "contract_amount": 48500.00,                 // required · finite number
  "client": {                                  // required · creates/updates the Contact
    "name": "Dana Johnson",
    "email": "dana@example.com",
    "phone": "+12105550137"
  }
}
```

Reference implementation: `packages/contracts/src/handoff.ts`. It reports **every**
problem at once rather than failing on the first, so if the shape is off you get
one complete list instead of a round trip per field.

**If any of those names should differ, tell us and we'll change ours** — you're
the one writing the producing side, and matching you is cheaper than matching us.

### The sync-back call we expect to make

Roughly hourly, once per project:

```
POST {BUILDSUITE_API_BASE_URL}/{your-endpoint}
Authorization: {however you want it}

{
  "buildsuite_project_id": "BSP-2026-000184",
  "project_stage": "In Progress",     // one of the 19 §7 stages, verbatim
  "progress_percentage": 65,
  "synced_at": "2026-08-04T17:00:00Z"
}
```

Entirely a proposal — send back the shape you actually want and we'll conform.
Read-only against GHL on our side; this is the only thing we write back to you.

---

## 3. Questions that need an answer, not code

Short ones, but each changes a design decision:

1. **Does BuildSuite emit any webhook we should listen to**, or is the handoff
   the only inbound event? We've assumed handoff-only.
2. **Is there a BuildSuite staging environment?** Testing an hourly job against
   production isn't great.
3. **Does BuildSuite need anything back from us** beyond stage and progress?
   Right now §8.3 is one-way and narrow, and we'd rather keep it that way, but
   better to hear now if you want more.
4. **Supabase** — we understand it's shared and it's production. We're treating
   it read-only and won't touch a table. Is there a restricted read key we
   should use rather than anything with write scope?

---

## 4. Two decisions on our side you should know about

Both departed from the original architecture, both with reasons — flagging in
case either affects your side.

**D-001 — the front-end is built in our repo, not GHL AI Studio.** AI Studio's
limitations didn't carry three permission-controlled experiences. No impact on
the handoff; the §12.3 split still stands, so contracts, invoices, receipts, and
payments continue routing through GHL's native Client Portal.

**D-002 — WF1–WF8 are application code, not GHL-native workflows.** §11 remains
the specification; only the implementation moved. The one downstream consequence:
**the Phase 6 snapshot no longer carries the front-end or the workflows**, so
"build once, snapshot everywhere" is a smaller multiplier than the plan assumed.
Chris and Pat need that before Phase 6.

---

## 5. What's unblocked on our side while we wait

So you know the critical path isn't idle:

- WF3/WF4 — the field → PM → client publishing loop, as code
- The sync-back job's scheduling, idempotency, and run-log structure, against a
  fake client that we swap for yours
- Client Visibility Settings, the last Phase-3 screen
- Real session plumbing minus the identity provider

What we **cannot** do without you is prove the chain end to end. That's the demo
that matters: sign a proposal in BuildSuite → the project appears → the stage
moves → the client sees progress.

---

## 6. Priority, if you only have an hour

1. **The GHL token** (§1.1) — unblocks the most.
2. **One real handoff payload** (§1.3.1) — ten minutes of your time, removes all
   remaining guesswork from the contract.
3. **The sync-back endpoint + whether it's idempotent** (§1.2).

Everything else can follow.

---

*Environment variable names above match `apps/web/.env.example` in the repo, so
values can be dropped straight in.*
