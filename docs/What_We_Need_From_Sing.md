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

> **Updated 2026-08-06.** Since BuildSuite already uses a GHL private integration
> key, this may be quicker than we thought — you've done it before. Two asks
> rather than one, though:
>
> **Please mint a separate key for the hub rather than sharing BuildSuite's.**
> Not distrust — lifecycle. If we share one and you rotate it, the hub breaks
> silently and neither of us connects the two events. Five extra minutes now.
>
> **Tell us if yours is agency-level or per-sub-account.** ARCHITECTURE §2 wants
> per-sub-account. If the practical path is an agency-level key, that's workable,
> but it's a wider blast radius than the architecture assumes and Chris should
> know before we build on it.

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

### 1.2a A proposal that might delete this workstream

You already hold a **GHL private integration key** — BuildSuite talks to GHL
server-to-server today. If that's right, **the stage sync-back should probably run
on your side, not ours.**

The job exists to move a project's GHL pipeline stage into BuildSuite's My Projects
view. You can already read that from GHL directly. Running it there removes three
problems in one go: no scoped service token needed (saving you the half-day to
day), no unattended job calling an API that has no machine auth, and the id
mismatch below stops mattering — you'd query GHL by whatever key you stamped at
handoff and you already know your own `projects.id`.

It also keeps the architecture's one-way boundary cleaner: BuildSuite → GHL at
handoff, BuildSuite reading GHL for status. Nothing calls back into BuildSuite from
outside at all.

**If you agree, §1.2 below goes away** and the only thing we need from you on this
front is confirmation. If you'd rather we own it, §1.2 stands as written.

### 1.2 The sync-back — **we need option B, and the id question answered**

> **Revised 2026-08-06** after reading `BuildSuite_API_Integration_Docs.md`. That
> document answered most of what was here and replaced it with two harder
> questions. Thank you for writing it from source — it saved us building against
> an endpoint that turns out to be broken.

**We need option B: the scoped service token.** §8.3 specifies a scheduled hourly
job, and option A (proxying the user's session) can't do that — it only runs while
someone is browsing, and the CORS restriction to `buildsuite.ai` origins would also
dictate our hosting. Option B keeps the design intact for the half-day to day you
quoted.

**The endpoint allowlist you asked for.** You said *"tell me exactly which
endpoints you need and I scope it to those."* Minimum viable set:

| Endpoint | Why |
|---|---|
| `GET /auth/me` | Resolve identity and confirm the token works |
| `GET /projects/my-projects` | Read the contractor's projects — the list the sync-back walks |
| **A stage-write endpoint** | See below. We don't think one currently works for us. |

**On the write, three problems your doc surfaced:**

1. `PUT /projects/{project_id}` is listed as **broken** — the GHL-contact-id vs
   UUID comparison, 403 for every non-admin caller. So the obvious candidate is out.
2. `PATCH /projects/my-projects/{project_id}/status` looks like the closest
   working thing, but it's keyed on `projects.id` and has state-machine
   validation. **Will it accept the 19 stage names from our GHL pipeline**
   (`New Project` → `Warranty`), or does it enforce BuildSuite's own status
   vocabulary? If the latter, we need a mapping and should agree it now.
3. **Is it idempotent under retry?** The job runs hourly across every project and
   retries on 5xx. If calling it twice with the same status does anything other
   than nothing, we design differently — dedupe keys, a run log, conditional writes.

### 1.2b The id question — **bigger than the credentials**

`buildsuite_project_id` does not appear anywhere in your API reference. Your doc
lists four id spaces — `contractors.id`, the GHL contact id, `auth_profiles.id`,
and `projects.id`/`deals.id` — and none of them is `BSP-YYYY-NNNNNN`.

Our whole model assumes that ID is BuildSuite's and travels with the project
(§5, §3.6: never match on name, address, or email). So:

- **Does `BSP-YYYY-NNNNNN` exist in BuildSuite at all**, or is it minted at
  handoff purely for GHL's benefit?
- If it's minted at handoff, **is it stored back on the BuildSuite project row?**
  If not, the sync-back has no way to find the project it needs to update, and
  we'd need to carry `projects.id` through the handoff as well.
- If it doesn't exist at all, the shared-key premise needs revisiting — and that
  affects the GHL schema, not just this job.

This is the one question we'd most like answered first. Everything else can be
worked around; this one changes the data model.

Also useful when you have a moment: rate limits, and whether there's a staging
environment, so we're not exercising an hourly job against production.

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

### 1.5 `bs_session` verification — the hub uses your auth, not its own

**Decision on our side (D-006): the project hub authenticates exactly the way
BuildSuite does** — the GHL login flow issuing `bs_session`. We're not standing up
a second identity system. That means the hub can call your API as the signed-in
user with their own permissions, and it satisfies your CORS restriction for free.

To verify the cookie server-side we need:

| What | Notes |
|---|---|
| JWT signing secret or public key | However you'd rather share it |
| Algorithm + expected claims | Which claim carries `auth_profile_id`, which carries the GHL contact id |
| Token lifetime / refresh behaviour | What we do when it expires mid-session |
| **A `.buildsuite.ai` subdomain** for the hub | Required — `COOKIE_DOMAIN=.buildsuite.ai` means the cookie only rides along on that domain. This is now a DNS dependency on you. |

**One question we can't answer ourselves:** do **client-portal users** (homeowners)
get a `bs_session`? They sign in to GHL's *native* Client Portal, which may be a
different path entirely. If they don't, the hub needs two verification paths — one
for contractor/field staff, one for clients — and we'd rather know now than
discover it when the client portal goes live.

**And note this doesn't remove the need for §1.2's service token.** A user session
can't run an unattended hourly job. Without it, the stage sync-back stops being
scheduled and becomes refresh-on-visit — meaning a stage change only reaches
BuildSuite when somebody happens to open the hub. That's a product decision, not
an implementation detail, so flagging it rather than quietly picking.

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
