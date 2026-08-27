# Using GoHighLevel and BuildSuite together

**Date:** 2026-08-28 · **Method:** measured against the live BuildSuite database, not inferred

The ownership split is right, and the schema already implements it. What is missing is not
design — it is **data**. The loop the four documents describe has never completed once.

---

## 1. The split, confirmed by the data

| Stage | Owner | Evidence in the live database |
|---|---|---|
| **Client ingestion** | **GoHighLevel** | `projects.source` includes `ghl_project_quote_survey` (28 of 101) and `client-application-webhook` (12). GHL is the front door. |
| **Contractor ↔ client matching** | **BuildSuite** | `deals.matched_contractor_id`, `deals.coverage_score`, `deals.coverage_threshold`. `projects.status = 'matched'` on 46 of 101. |
| **Proposal, estimate, signing** | **BuildSuite** | `proposals` (42 columns), `deals.signature_status`, `signed_pdf_url`, `adobe_agreement_id`. |
| **Handoff at signing** | **BuildSuite → GHL** | `deals.sent_to_crm_at`, `deals.crm_document_id`. |
| **Operational execution** | **GoHighLevel** | Not yet built — the Project custom object does not exist. |
| **Presentation + privacy** | **Project Hub** | Built. The three views and the gate. |

Nothing here contradicts the documents. BuildSuite is the front half — who the client is, which
contractor is on it, what it costs. GoHighLevel is the back half — what happens after someone
signs. The Hub is the window onto both.

---

## 2. The pipeline that already exists

BuildSuite models the whole intake-to-signature lifecycle. `deals.status` moves through:

```
intake_started → questions_in_progress → intake_complete
              → draft_ready → contractor_selected → proposal_sent
                                                  → [signature] → sent_to_crm
```

That is a real matching-and-proposal engine, and it is more complete than any of the four
documents describe.

---

## 3. Where it actually breaks — the funnel, measured

**182 deals. Here is how far they get:**

| Step | Count | % |
|---|---|---|
| Deals created | 182 | 100% |
| Linked to a project row (`source_project_id`) | 47 | 26% |
| **Matched to a contractor** (`matched_contractor_id`) | **5** | **3%** |
| **Sent to CRM** (`sent_to_crm_at`) | **2** | **1%** |
| Signature sent | 1 | 1% |
| **Signature signed** | **0** | **0%** |

**No deal has ever been signed.** The handoff has fired twice. The operational half of the
system has never been given a real project to manage.

This is the single most important fact on this page, and it reframes everything else: we are not
blocked on building project management. We are blocked because **nothing has yet reached the
point where project management begins.**

---

## 4. Two questions this answers

### "How is a contractor bid classified as won?"

Open since 2026-08-20, and blocking the filter to signed-only work.

**The field exists.** It is not on `projects` — it is on `deals`:

- `signature_status` — `SENT` today; presumably `SIGNED` or similar on completion
- `signature_signed_at` — the timestamp, and the cleanest test
- `sent_to_crm_at` — the handoff moment, which is the operational definition of won
- `signed_pdf_url`, `adobe_agreement_id` — the artefacts

**Why we could not find it:** we were looking at `projects`, and the answer lives in `deals`.
And every one of those columns is empty or near-empty, so no amount of sampling `projects` would
have revealed it.

**The filter, once data exists:** a project is *signed work* when its deal has
`signature_signed_at` set, or `sent_to_crm_at` set. Both are on `deals`, joined by
`deals.source_project_id → projects.id`.

### "Which ID links the systems?" (C-3)

**Your description resolves it.** If GoHighLevel ingests and BuildSuite matches and proposes,
then **the project is born in BuildSuite** — it does not exist as a project until a contractor is
matched to a client. Whoever creates a record owns its identifier.

So: **BuildSuite generates the id; GoHighLevel stores and copies it.** That is D4 §6's first
sentence, and it overrules D4 §6's own second sentence about the GHL opportunity id being the
matching key. The opportunity id is a useful *secondary* link for the sales side; it is not the
project key, and at 0/182 populated it could not be one today.

**The chain that should exist, and its current state:**

```
GHL contact ──→ deals.ghl_contact_id          2/182   ✗ broken
             ──→ deals.matched_contractor_id    5/182   ✗ barely used
             ──→ deals.source_project_id       47/182   ~ partial
             ──→ projects.id                  101/101   ✓ works
             ──→ [handoff] GHL Project object     —     ✗ does not exist
```

Three of the five links are effectively empty. The Hub keys on `projects.id` because it is the
only one that is populated everywhere.

---

## 5. How to build real project management on this

In dependency order. Each step is small; the ordering is what matters.

**Step 1 — Make one deal complete the loop.** One real client, matched to a contractor, proposal
sent, signed. Not a schema change: an operational run. Until that happens there is no signed
project for anything downstream to manage, and every later step is untestable.

**Step 2 — Populate `ghl_contact_id` on the deal at intake.** GHL owns ingestion, so the contact
exists before the deal does. Writing it at intake costs nothing and it is the only link back to
the CRM. At 2/182 today, the client half of the join is missing.

**Step 3 — Create the GHL Project custom object.** Pat, and gated on the tier check. This is
where execution lives: milestones, tasks, stage pipeline, calendar. Without it there is no
operational record to manage.

**Step 4 — Extend Send-to-CRM to stamp identity.** Sing, ~1 day. At signing, write the BuildSuite
project id onto the GHL record, and write the GHL record id back onto the deal. One call, both
directions, and the join is closed permanently.

**Step 5 — Point the Hub at GHL for operational reads.** Config, not build. `GhlDataSource`
already exists; it needs the object key.

**Step 6 — Turn on the webhook.** Built and tested. Needs the secret. Then a stage change in GHL
reaches the Hub without polling.

**What the Hub does not need to change.** The three views, the privacy gate, the approval loop,
the permission matrix and all eight workflows are already written against this model. They read
from a data-source interface, and swapping fixtures for GHL is a source change, not a rewrite.

---

## 6. The honest summary

The architecture is right and largely built. The two systems divide cleanly and the schema in
both already anticipates the join.

**What is missing is a single signed job.** Two deals have reached the CRM and none has been
signed, so the operational half has never run on anything real. Every remaining technical task —
the object, the key, the webhook, the stamp — is small. They are simply all downstream of one
deal getting all the way through.

That is a better problem to have than a design flaw, but it should be said plainly rather than
described as an integration gap.
