# GHL Project Custom Object — Schema Draft (for approval before creation)

**Prepared:** 2026-08-25 · **Sub-account:** Alliance For Contractors (`IifYfP2B2NUaoDPdsTTa`)
**Status:** DRAFT — nothing is created in GHL until Chris signs off on this schema.

Creating a custom object in the live production sub-account is a real write.
Per D-023 (Dale owns the GHL build) **and** the CLAUDE.md live-system guardrail,
the schema below is confirmed first, then created. Field names follow Artifacts
88/91 verbatim (D-021).

---

## What this object is, and is not

The **Project** custom object is GHL's operational record of an active job —
identity, the link IDs to the other systems, status, and the fields GHL owns
after handoff. It is the source of `GHL_PROJECT_OBJECT_KEY`, which unblocks the
Hub's live GHL reads.

**It does not duplicate everyone's source of truth (Artifact 91):**
- **BuildSuite** owns the money truth (contract, estimate, markup, margin) and
  the proposal/scope. Those are *referenced* here, not re-owned.
- **The Hub's own `hub_` tables** (D-014) own field updates, approvals, photos,
  change-order records, messages. Not on this object.
- GHL owns the contact/opportunity relationship and the operational status.

So this object is deliberately lean: identity, link keys, status, and the
client-facing operational fields — not a copy of BuildSuite or the Hub.

Object-key pattern from the existing Affiliate object is `custom_objects.affiliates`,
so this will be **`custom_objects.projects`** (GHL derives the key from the name
on creation — confirm the exact string in the create response).

---

## Fields

Legend — **Vis:** Client = surfaces to the homeowner portal (still behind the
visibility switches); Internal = contractor/GHL only, never client. **Src:** where
the value originates.

### Identity
| Field | Key (proposed) | Type | Vis | Src |
|---|---|---|---|---|
| Project Name *(display property)* | `project_name` | Text | Client | BuildSuite |
| Project Address | `project_address` | Text | Client | BuildSuite |
| Project Type / Trade | `project_type` | Text | Client | BuildSuite |
| Client Name | `client_name` | Text | Client | BuildSuite |

### Link IDs (Artifact 91 field map)
| Field | Key | Type | Vis | Src |
|---|---|---|---|---|
| **The join key** — see C-1 below | *pending* | Text | Internal | *pending* |
| BuildSuite Project ID | `buildsuite_project_id` | Text | Internal | BuildSuite |
| AFC Intake ID | `afc_intake_id` | Text | Internal | GHL |
| GHL Contact | *native relation* | Relation → Contact | Internal | GHL |
| GHL Opportunity | *native relation* | Relation → Opportunity | Internal | GHL |

### Status (Artifact 88 — the internal/client split is the point)
| Field | Key | Type | Vis | Src |
|---|---|---|---|---|
| Project Status (internal) | `project_status_internal` | Dropdown (16, below) | Internal | Hub/Contractor |
| Client Status Label | `client_status_label` | Text | Client | Hub/Contractor |
| Current Milestone | `milestone_current` | Text | Client (approved) | Hub |
| Status Owner | `status_owner` | Text | Internal | Hub |
| Next Action Due | `next_action_due` | Date | Internal | Hub |

`project_status_internal` options (Artifact 88): INTAKE_REVIEW, SCOPE_BUILD,
ESTIMATE_REVIEW, PROPOSAL_READY, CLIENT_DECISION, SCHEDULE_SETUP, ACTIVE_WORK,
WAITING_MATERIALS, INSPECTION_PENDING, CHANGE_ORDER_PENDING, DELAY_REVIEW,
PUNCH_LIST, CLOSEOUT_REVIEW, COMPLETED, WARRANTY_REVIEW, ON_HOLD, ARCHIVED.
*(Count still under C-2 — see below. Create the dropdown once that's settled.)*

### Financials — client-visible (still gated by the portal switches)
| Field | Key | Type | Vis |
|---|---|---|---|
| Contract Amount | `contract_amount` | Monetary | Client |
| Approved Change Orders | `approved_change_orders` | Monetary | Client |
| Pending Change Orders | `pending_change_orders` | Monetary | Client |
| Current Project Total | `current_project_total` | Monetary | Client |
| Amount Invoiced / Paid / Remaining | `amount_invoiced` / `amount_paid` / `remaining_balance` | Monetary | Client |
| Payment Status Language | `payment_status_language` | Text | Client |

### Financials — INTERNAL (deny-list; never in a client response)
| Field | Key | Type | Vis |
|---|---|---|---|
| Original Estimate | `original_estimate` | Monetary | Internal |
| Markup | `internal_markup` | Percent | Internal |
| Margin | `margin` | Percent | Internal |

These may live on the GHL object because GHL is the contractor's internal CRM —
but they must **never** be mapped into the client portal projection. The Hub's
gate (`client-projection.ts`) already enforces that; the deny-list names match.

### Change order / closeout / warranty (status mirrors — records stay in `hub_`)
| Field | Key | Type | Vis |
|---|---|---|---|
| Change Order Status | `change_order_status` | Dropdown (Artifact 89) | Client if published |
| Closeout Status | `closeout_status` | Dropdown | Client when approved |
| Warranty Review Status | `warranty_review_status` | Dropdown | Careful/limited (90) |
| Field Update Review Status | `field_update_review_status` | Dropdown | Internal |

---

## The one field blocked by a decision — C-1

The **join key** is unresolved (see `phase-6-artifacts-crossref.md` C-1). Four
candidates: ProjectHub Project ID (artifacts call it primary), BuildSuite Project
ID, the APS job number, or `ghl_opportunity_id`. **This is the only field I will
not create until Chris + Sing pick one and say who generates it.** Everything
else can be created now; this one waits.

Recommendation to put to them: match on a **system-generated** key nobody types —
`ghl_opportunity_id` (already on every BuildSuite row) or a BuildSuite-generated
`buildsuite_project_id` — and keep the APS number as a human-readable *label*
field, not the join key. That removes the typo failure mode.

---

## Creation plan (once approved)

Read-only discovery already confirmed the tier supports custom objects. On the
go-ahead, in order:

1. **Create the object** `custom_objects.projects` with `project_name` as the
   display property (GHL API `POST /objects/` with `locationId`, or Settings →
   Objects in the UI). Capture the returned object key.
2. **Create the fields** above except the C-1 join key. Dropdowns get their
   options from the settled Artifact-88 status list.
3. **Set `GHL_PROJECT_OBJECT_KEY`** on Vercel to the returned key + redeploy →
   the Hub's live GHL read path lights up.
4. **Add the join-key field** once C-1 is decided, then wire the match.
5. Verify with one test record end to end (create in GHL → read in the Hub).

Steps 1–3 are the critical path to the live key. Step 4 waits on the huddle.

---

## What I need from Chris to proceed

- **Go / no-go on this schema** (field names, which are client vs internal).
- **C-1** — the join key + who generates it (blocks step 4, not steps 1–3).
- Confirmation I should create it under `custom_objects.projects`, or a name he
  prefers.

Steps 1–3 I can run the moment the schema's approved — they don't wait on C-1.
