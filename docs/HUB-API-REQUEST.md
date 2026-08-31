# What the Project Hub needs from BuildSuite

**For:** Sing · **From:** Dale · **Date:** 2026-09-01
**In reply to:** the offer to expose endpoints instead of direct database access

Yes please, and thank you for offering. Direct table reads were always the
stopgap — an endpoint means a schema change is your deploy rather than our
outage, and it lets you keep columns private that we currently have to be
trusted not to select.

Below is exactly what we read today, so you can size it. **Five endpoints would
replace everything.**

---

## 0. Two corrections to what we had, from your message

You are right on both and they are already fixed in our code:

**Signature is on `proposals`, not `deals`.** We had been reporting "0 of 182
signed" from `deals.signature_signed_at`. Reading `proposals` instead found four
SIGNED rows with `adobe_agreement_id` and `signed_pdf_url`, February 2026. One
job, signed once — not none, ever.

**Matching is not `deals.matched_contractor_id`.** We now read
`proposals.contractor_id`. And thank you for naming
`project_contractor_matches` — we had not found it. 272 rows across 47 projects
and 23 contractors, which is a much better picture of matching than the 5 rows
on `deals`.

One observation on that table, offered as information rather than a complaint:
`contractor_accepted`, `client_selected` and `project_outcome` are **null on all
272 rows**, and `projects.status` has no `awarded` value (it holds `active` 43,
`matched` 46, `draft` 9, `new` 2, `completed` 1). So the award step you describe
looks correct as a design but has not yet written anything. If awarding is meant
to set `client_selected`, that is worth knowing before we build against it —
we would rather ask than assume the column is dead.

---

## 1. What the Hub is for, so the shape makes sense

The Hub manages **work that already has a deal**. It is not a sales tool. A
contractor signs in and needs: which jobs are mine, who is the client, what did
we quote, is it signed. Everything after that (milestones, field updates,
photos, client visibility) we store in our own database and never ask you for.

So we do not need most of your schema. We need identity, the book of work, and
enough project detail to label a row.

---

## 2. The five endpoints

### 2.1 `GET /hub/me` — which contractor is this?

**The one we need most.** Everything else is filtered by it.

Given the signed-in user, return their contractor. We currently do this by
reading `auth_profiles` and then `contractors`, trying three links in order:
`auth_profiles.contractor_id` (populated on 1 of 110), then
`auth_profiles.contact_id` → `contractors.ghl_contact_id` (the one that works —
472 of 483 contractors have it), then email.

```json
{ "contractor_id": "5dd312bd-…", "business_name": "AFC", "matched_via": "ghl_contact" }
```

If you expose this, we delete our resolver entirely and stop reading
`auth_profiles` and `contractors` at all.

**Ambiguity matters here.** Seven `ghl_contact_id` values are shared by more
than one contractor. We resolve those to nothing rather than guessing, because
guessing shows someone another company's jobs. Please do the same, or tell us
how you would rather disambiguate.

### 2.2 `GET /hub/engagements?contractor_id=…` — the book of work

Live proposals for one contractor. This is the Hub's main screen.

```json
[{
  "project_id": "87a42c43-…",
  "proposal_id": "80fa395a-…",
  "status": "accepted",
  "price": "$2,000 - $5,000",
  "total": 8000,
  "timeline": "Within 2-4 Weeks",
  "signature_status": "SIGNED",
  "signature_signed_at": "2026-02-11T02:51:28Z",
  "submitted_at": "…", "accepted_at": null, "rejected_at": null,
  "updated_at": "…"
}]
```

Fields we use, from `proposals`: `id`, `project_id`, `contractor_id`, `status`,
`price`, `subtotal`, `total`, `timeline`, `valid_until`, `created_at`,
`updated_at`, `submitted_at`, `accepted_at`, `rejected_at`, `signature_status`,
`signature_sent_at`, `signature_signed_at`, `source_deal_id`, `deleted_at`.

**We deliberately do not read** `content`, `sections`, `pdf_url`, `docx_url`,
`signed_pdf_url`, `ai_feedback`, `notes`, `share_feedback`,
`acceptance_notes`, `rejection_feedback`. No screen needs them.

Two behaviours worth keeping in the endpoint:

- **Several proposals per project is normal** — the signed project has seven. We
  rank signed over accepted over submitted, then most recently updated. If you
  return them all we will keep doing that; if you would rather return one
  current proposal per project, even better.
- **`total` is set on 8 of 46; `price` is free text on all 46.** We only treat a
  real number as an amount and never parse `"$25k-$50k"` into one, because a
  wrong figure on a contract is worse than a missing one.

### 2.3 `GET /hub/projects?ids=…` — labels for a row

Enough to render a project without a second call.

From `projects`: `id`, `title`, `status`, `source`, `created_at`, `updated_at`,
`street_address`, `city`, `state`, `postal_code`, `trade`, `project_type`,
`budget_band`, `exact_budget`, `start_date`, `end_date`, `client_name`,
`ghl_contact_id`, `ghl_opportunity_id`.

**One thing to fix while you are in there:** the signed project
(`87a42c43-0f0e-4d2b-b07d-65311aa04d29`) is **not readable** with our key —
RLS hides it. So the one real job in the system shows in our UI as "project
details not readable". We show it anyway rather than dropping it, but a name
would be better than a caveat.

### 2.4 `GET /hub/matches?contractor_id=…` — optional, useful

`project_contractor_matches` for a contractor: `project_id`, `contractor_id`,
`score`, `status`, `matched_at`, `notified_at`, and the outcome columns when
they start being written.

Not urgent. It would let a contractor see work they were offered and have not
bid on yet, which today they cannot see at all.

### 2.5 A webhook when something changes — the one that would help most long-term

Rather than us polling, tell us when a proposal is signed or a project is
awarded. We already have a verified webhook receiver with signature checking,
timestamp windows and replay rejection at
`POST /api/ghl/webhook`; pointing a second one at us is small work our side.

---

## 3. Two questions

1. **Is `client_selected` on `project_contractor_matches` the award signal**, or
   is awarding represented somewhere else? All 272 are null and there is no
   `awarded` status on `projects`, so we cannot tell from the data.

2. **Is `signature_signed_at` the field that means "won"?** We treat
   `signature_status = 'SIGNED'` OR `signature_signed_at` being set as won,
   whichever appears first. Four rows carry both, so it has never mattered — but
   we would rather have it confirmed than inferred from four rows.

---

## 4. What we do NOT need

Stated so the endpoints do not grow to cover things nobody asked for:

- Nothing from `deals`. We read it for a pipeline screen and can drop that.
- No document bodies, PDFs or AI text.
- No client email or phone. They exist on your tables; we do not select them and
  have no screen for them.
- No write access of any kind. Everything the Hub writes goes to its own
  database. BuildSuite stays read-only from our side, permanently.

---

## 5. Until then

We keep reading the tables directly, with the narrow column lists above. If a
schema change breaks us that is our problem to fix, not a reason for you to
hold back a change — say what changed and we will follow.

Whatever shape you land on, one small ask: **a versioned path** (`/v1/…`) so a
future change can ship without a flag day.
