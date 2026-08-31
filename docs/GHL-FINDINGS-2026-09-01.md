# What is actually in GoHighLevel — probed 2026-09-01

**Method:** read-only calls against the live Alliance sub-account with our
integration token. No writes.

Three things we have been treating as blocked for two weeks are not blocked.
One of them contradicts a decision Chris made this morning, so it needs raising
before anyone builds against either answer.

---

## 1. Custom Objects are supported. The tier question is answered.

`GET /objects/?locationId=…` returns **200** with five objects:

```
business                     Companies
opportunity                  Opportunities
contact                      Contacts
custom_objects.affiliates    Affiliates
custom_objects.projects      Projects   "Operational record of an active job after handoff."
```

**This has been the top item on Pat's list since 2026-08-21** — "does the
Alliance sub-account tier support Custom Objects?" It does, and the question can
come off every list it is on.

## 2. The Projects object already exists, with the schema we needed

`custom_objects.projects`, sixteen fields:

| Field | Type |
|---|---|
| `project_name`, `project_address`, `project_type`, `client_name` | TEXT |
| **`buildsuite_project_id`** | TEXT |
| `afc_intake_id`, `client_status_label`, `milestone_current` | TEXT |
| `payment_status_language` | TEXT |
| `contract_amount`, `approved_change_orders`, `pending_change_orders` | MONETORY |
| `current_project_total`, `amount_invoiced`, `amount_paid`, `remaining_balance` | MONETORY |

Somebody built this and it closely matches the §7 model. **The object key we
have been waiting for is `custom_objects.projects`** — that is the value for
`GHL_PROJECT_OBJECT_KEY`, and setting it switches our data source from
BuildSuite to GoHighLevel for operational reads.

Note the last four money fields. `amount_invoiced`, `amount_paid` and
`remaining_balance` only make sense if invoicing is meant to flow into this
record, which bears on the payments decision below.

## 3. **The one record in it uses the UUID as the shared key — not the BSA code**

One Project record exists:

```
id                     6a9548f1a864e851b98c37e5
project_name           [DEMO] Mike's Kitchen Remodel
client_name            Tom
buildsuite_project_id  7b9eefb9-41d2-424a-8885-68ac4f941454   <-- a UUID
client_status_label    Work In Progress
milestone_current      Cabinet Installation
```

Created by an integration over OAuth, so somebody wired this deliberately.

**And the BuildSuite project it points at has `project_code: null`.** I checked:
`7b9eefb9` is "mike kitchen", owner Ralph, and it has no BSA code at all.

**So the two answers are incompatible as stated.** Chris confirmed this morning
that the shared key is `project_code`, the BSA number. The GHL object already in
place is keyed on the BuildSuite UUID, and the one project in it could not have
a BSA key, because it does not have one.

Somebody has to choose, and it is worth choosing quickly because both Sing's
handoff stamp and our id-pattern change are waiting on it:

- **If the key is the UUID** — it is already in use, it is populated on 101 of
  101 projects, and nothing needs backfilling. The existing GHL record stays
  valid. Our contract change is the same size either way.
- **If the key is `project_code`** — the existing record needs rewriting, and 53
  projects need codes before they can be handed over.

I have not touched the record. This is Chris's and Sing's call.

---

## 4. Invoicing is live on this account

Chris asked whether GHL invoicing could fire from a workflow. Partial answer,
and the useful half is better than expected.

```
GET /invoices/          200   real invoices, status "sent", liveMode true
GET /invoices/template  200   templates exist, e.g. "Digital Bronze Plan 50% off"
GET /invoices/schedule  200   empty, but the endpoint is there
```

So invoicing is not a tier question. It is set up, in use, and reachable with
the token we already hold.

**The part that answers his actual concern:** we do not need GoHighLevel's
workflow builder to have an invoice action. Our own workflow engine can call the
invoice API directly at the point the workflow decides an invoice is due. That
is the same shape as every other effect we already run, and it means the
GHL-versus-Stripe choice is not constrained by what the workflow builder can do.

**What I have NOT verified, deliberately:** whether creation works. That needs a
`POST /invoices/`, which creates a real invoice on a live account with real
customers on it. I am not doing that without someone saying so, and it should be
against a test contact.

**My recommendation, now that invoicing is confirmed live:** GoHighLevel rather
than Stripe. The money fields on the Projects object are already there waiting
for it, the invoice sits beside the operational record, and there is no second
system holding payment data. Stripe would mean reconciling two.

---

## 5. What to change, and what it unblocks

| | |
|---|---|
| `GHL_PROJECT_OBJECT_KEY=custom_objects.projects` | Switches operational reads to GHL. **Not set yet** — see the caveat |
| Pat's tier question | Closed. Answer is yes |
| Pat's object key | Closed. It is `custom_objects.projects` |
| The shared key | **Reopened.** GHL uses the UUID; Chris said BSA code |
| Payments rail | GHL invoicing is live; recommend GHL over Stripe |

**The caveat on setting the object key.** Doing it switches
`getDataSource` from BuildSuite to `GhlDataSource` for every operational read,
and that path has never run against real data. It should be a deliberate change
with someone watching, not something that happens because a variable got set —
so I have left it unset and written it down instead.

Still genuinely outstanding: **the webhook secret**. Without it the receiver
refuses every delivery, which is correct and unchanged.
