# BuildSuite™ Three-Experience Platform — Architecture (Source of Truth)

> **Status:** Canonical. **Version:** 1.0 · 2026-07-30
> **Audience:** Claude Code and any engineer/agent building this system.
> This file is the single source of truth. When code, prompts, or other docs
> disagree with this file, **this file wins**. Do not silently invent schema,
> field names, workflow behavior, or visibility rules — if something needed is
> not defined here, treat it as an **open decision** (see §16) and ask.

---

## 0. How to use this document

- Every **MUST** / **MUST NOT** is a hard invariant. Violating one is a defect,
  regardless of test results.
- Field names, object names, stage names, and the shared-ID format are
  **verbatim contracts**. Match casing and spelling exactly.
- Build strictly in the phase order of §14. Do not build a later phase's
  surface area before its prerequisite data/workflows exist.
- Nothing in Phase 1+ starts until the Phase 0 gates in §15 pass.
- The client-visibility rules in §9 are enforced **at the data layer**, never
  only in the UI.

---

## 1. System context & boundary

BuildSuite handles **estimating, proposals, takeoffs, profitability**. At
proposal signing it hands the project off to **GoHighLevel (GHL)**, which owns
**all operational execution** thereafter. The three user experiences are not
three systems — they are three permission-controlled views of **one shared GHL
project record**.

```
                 BuildSuite (estimating / proposals / takeoffs / profit)
                                     │
                                     │  Send to CRM  ── handoff (one-way, see §8)
                                     ▼
                          GHL Project Record  (single backbone)
                                     │
             ┌───────────────────────┼───────────────────────┐
             ▼                       ▼                       ▼
   Contractor Dashboard       Field Interface          Client Portal
   (create & control)         (submit only)            (approved views only)
```

### Boundary rules (MUST)
1. The portals **MUST NOT** call BuildSuite directly. The only BuildSuite→GHL
   channel is the Send-to-CRM handoff (§8).
2. After handoff, **GHL owns** milestones, tasks, daily updates, selections,
   change orders, issues, messages, documents, invoices, approvals, field
   updates. BuildSuite does not create these.
3. One backward channel is allowed: a scheduled **Stage Sync-back** job reads
   each project's GHL pipeline stage (by shared ID) and updates BuildSuite's
   "My Projects" view (§8.3).
4. A GHL Contact **MAY** have multiple Projects. **MUST NOT** assume
   one-contact-equals-one-project anywhere in schema, queries, or UI.

---

## 2. Environments & naming

| Environment | Name / purpose | Notes |
|---|---|---|
| Master build sub-account | `BuildSuite™ Development / Template` | Clean source of the snapshot. All objects, pipeline, workflows, AI Studio apps, forms, portal setup live here. **No live client data.** |
| Test contractor sub-account | (throwaway) | Receives the snapshot in Phase 0 Test A. |
| First live implementation | `Alliance Pro Services` | First real deployment, after the build sub-account is proven. |

Each sub-account uses its **own integration token**. The build sub-account's
token is provisioned before Phase 0 (owner: Sing).

### Routes (per contractor domain)
| Experience | Route | Indexing |
|---|---|---|
| Contractor Dashboard | `projects.<contractordomain>/dashboard` | Not publicly indexed |
| Field Interface | `projects.<contractordomain>/field` | Not publicly indexed |
| Client Portal | `portal.<contractordomain>` | Authenticated |

---

## 3. Core invariants (never violate)

1. **One record, three views.** The `Project` custom object is the backbone.
   Visibility is per-item, not per-system.
2. **Publishing approval path.** Field submits → contractor reviews & edits the
   client summary → contractor publishes. Field updates **MUST NOT** be
   auto-published to the client. (State machine: §10.)
3. **The client-facing gate.** A record reaches the client **only** when
   `Client Visible = Yes` **AND** `Manager Approval = Approved`. Anything else
   stays internal.
4. **Authenticated access for anything that matters.** Email + Project ID is a
   *lookup convenience only*. It **MUST NOT** gate approvals, money, documents,
   contracts, private messages, or warranty records — those require GHL portal
   login. (§9.2)
5. **Internal fields never cross the boundary.** The deny-list in §9.3 is
   **never** serialized into any client-facing response.
6. **One shared key.** The **BuildSuite Project ID** (§5) is the master
   identifier across BuildSuite, GHL, and Supabase. Never match records by
   name/address/email/opportunity-title.
7. **Ship slices.** Prove the end-to-end data chain before widening scope.
   Accounting, warranty, vendor, and advanced reporting come after the core
   connection works.

---

## 4. Object model overview

One primary object + nine supporting objects, all associated back to `Project`
and, through it, to `Contact`.

```
Contact
 └── Project                      (primary)
      ├── Project Milestone
      ├── Project Task
      ├── Daily Update
      ├── Material Selection
      ├── Change Order
      ├── Project Issue
      ├── Project Message
      ├── Punch List Item
      └── Warranty Request

Project
 ├── Opportunity   (commercial/sales lifecycle)
 ├── Company
 ├── Primary Client (Contact)
 ├── Project Manager (User)
 └── Field Team (Users)
```

> **Opportunity vs Project:** the **Opportunity** represents the commercial /
> sales lifecycle; the **Project** custom object represents the operational
> record. They stay associated but are distinct.

---

## 5. Identity — the shared key

- **Field:** `BuildSuite Project ID`
- **Format:** `BSP-YYYY-NNNNNN` — e.g. `BSP-2026-000184`
- **Test fixtures:** `BSP-TEST-001`
- **MUST exist in:** BuildSuite · GHL Project object · GHL Contact/Opportunity ·
  Supabase (when used) · every external API call · every workflow webhook payload.
- **Immutable.** Names and addresses change; this ID does not.

---

## 6. Data model — canonical schema

Field **Type** legend: `text`, `longtext`, `number`, `currency`, `date`,
`bool` (checkbox), `select` (single dropdown), `multiselect`, `user`, `file`,
`percent` (number 0–100), `url`, `email`, `phone`.

`CV` column = eligible to be shown to a client **only if** the record also
passes the §3.3 gate. Absence of `CV` means **internal-only, never client-facing**.

### 6.1 `Project` (primary — `Projects`, display field `Project Name`)

**Identity**
| Field | Type | CV | Notes |
|---|---|---|---|
| Project Name | text | ✓ | Primary display |
| BuildSuite Project ID | text | | Shared key (§5), unique |
| Project Number | text | ✓ | |
| Project Type | select | ✓ | construction/remodel/repair/maintenance/specialty |
| Project Description | longtext | ✓ | |
| Project Address | text | ✓ | |
| Property Type | select | ✓ | |
| Client Name | text | ✓ | |
| Primary Contact | user/contact | | assoc → Contact |
| Project Manager | user | ✓* | *name only if "Show Assigned Team" enabled |
| Estimator | user | | |
| Superintendent | user | ✓* | |
| Sales Representative | user | | |

**Status**
| Field | Type | CV | Notes |
|---|---|---|---|
| Project Stage | select | ✓ | mirrors pipeline (§7) |
| Project Status | select | ✓ | |
| Progress Percentage | percent | ✓ | field used in Phase 0 Test B |
| Current Milestone | text | ✓ | |
| Next Milestone | text | ✓ | |
| Client Action Required | bool | ✓ | drives portal action-queue |
| Internal Priority | select | | internal-only |
| Health Status | select | | On Track / Attention Needed / At Risk / Delayed / On Hold / Completed |
| Delay Reason | longtext | | internal-only |
| Last Updated Date | date | ✓ | |
| Last Updated By | user | | |

**Dates**
| Field | Type | CV |
|---|---|---|
| Estimated Start Date | date | ✓ |
| Actual Start Date | date | ✓ |
| Estimated Completion Date | date | ✓ |
| Revised Completion Date | date | ✓ |
| Actual Completion Date | date | ✓ |
| Final Walkthrough Date | date | ✓ |
| Warranty Start Date | date | ✓ |
| Warranty Expiration Date | date | ✓ |

**Financials** — see §9.3 for the hard deny-list.
| Field | Type | CV | Notes |
|---|---|---|---|
| Original Estimate | currency | | internal-only |
| Contract Amount | currency | ✓ | from handoff |
| Approved Change Orders | currency | ✓ | |
| Pending Change Orders | currency | ✓ | |
| Current Project Total | currency | ✓ | |
| Amount Invoiced | currency | ✓ | |
| Amount Paid | currency | ✓ | |
| Remaining Balance | currency | ✓ | |
| Next Payment Amount | currency | ✓ | |
| Next Payment Due Date | date | ✓ | |

**Client-visibility controls** (per-project switches; gate still applies)
| Field | Type | Notes |
|---|---|---|
| Client Portal Enabled | bool | master switch |
| Show Budget to Client | bool | |
| Show Detailed Pricing | bool | |
| Show Schedule to Client | bool | |
| Show Assigned Team | bool | gates PM/Superintendent names |
| Allow Client Messaging | bool | |
| Allow Issue Submission | bool | |
| Allow File Uploads | bool | |
| Portal Access Status | select | |

### 6.2 `Project Milestone`
`Project` (assoc), Milestone Name, Description, Planned Start, Planned End,
Actual Start, Actual End, Sequence/Order, Dependency, Assigned Team (user),
Status (`select`), Delay Reason, `Client Visible` (bool), `Client Summary`.

### 6.3 `Project Task`
`Project`, `Milestone`, Task Name, Description, Assigned User, Assigned Trade,
Priority, Scheduled Date, Start Date, Due Date, Status, Completion Percentage,
Dependency, `Client Visible`, `Client Action Required`, Required Evidence,
Blocker, Completion Notes, Completion Photo (`file`).

**Task Status enum (verbatim):** Not Started · Scheduled · In Progress · Blocked ·
Waiting on Client · Waiting on Material · Waiting on Inspection · Ready for Review · Completed.

### 6.4 `Daily Update`  *(central to the publishing state machine, §10)*
`Project`, Update Date, Submitted By (user), Work Completed, Work in Progress,
Work Planned Next, Crew Onsite, Hours Worked, Materials Used, Materials Delivered,
Weather, Inspection Activity, Delays, Safety Notes, Client Decision Needed,
**`Internal Notes` (never client-facing)**, **`Client Summary`**,
`Client Visible` (bool), **`Manager Approval Status` (select: Pending / Returned / Approved Internally / Approved & Published)**, Publish Date, Notify Client (bool).

### 6.5 `Material Selection`
`Project`, Selection Name, Category, Room or Area, Manufacturer, Product,
Model Number, Color, Finish, Quantity, Supplier, Product Link (`url`),
Allowance (`currency`), **Actual Cost (internal)**, Upgrade Amount, Credit Amount,
Lead Time, Approval Deadline, Status, Client Decision, Client Comments,
Approved Date, Ordered Date, Received Date, Installed Date.

### 6.6 `Change Order`
`Project`, Change Order Number, Title, Description, Reason, Requested By,
Created Date, Added Cost, Credit Amount, Tax, Schedule Impact,
Revised Completion Date, Approval Deadline, Payment Requirement, Terms, Status,
Client Comments, Approved By, Approval Date, Invoice Status, Payment Status.

### 6.7 `Project Issue`
`Project`, Issue Number, Issue Title, Category, Description, Project Area,
Priority, Reported By, Assigned To, Submitted Date, Target Resolution Date,
Status, **`Internal Notes` (never client-facing)**, `Client Update`,
Resolution, Client Confirmation.

**Issue Category enum (verbatim):** Safety Concern · Damage · Missing Material ·
Incorrect Material · Design Conflict · Access Problem · Client Request ·
Inspection Problem · Schedule Delay · Equipment Problem · Other.

### 6.8 `Project Message`
`Project`, Thread Category, Subject, Sender, Recipient, Message, Sent Date,
`Client Visible`, Action Required, Related Task, Related Selection,
Related Change Order, Related Issue.

### 6.9 `Punch List Item`
`Project`, Item Number, Description, Location, Assigned To, Date Created,
Target Completion, Status, Completion Notes, Client Confirmation, Completed Date.

### 6.10 `Warranty Request`
`Project`, Request Number, Covered Item, Description, Date First Noticed,
Submitted Date, Assigned To, Coverage Status, Appointment Date, Status,
Resolution, Closed Date.

---

## 7. Pipeline — `BuildSuite™ Project Lifecycle`

19 sequential lifecycle stages plus two non-linear stages. Names are verbatim.

**Sequential:** New Project → Estimate in Development → Estimate Sent →
Estimate Approved → Contract Sent → Contract Signed → Deposit Due →
Deposit Paid → Planning → Design and Selections → Permitting →
Materials Ordered → Scheduled → In Progress → Inspection → Punch List →
Final Payment Due → Completed → Warranty

**Non-linear:** On Hold · Canceled

> Pipeline lives on the **Opportunity** (commercial lifecycle). Workflow 2 syncs
> the stage onto the `Project.Project Stage` field.

---

## 8. Integration contract — BuildSuite → GHL handoff

### 8.1 Trigger
The existing **Send to CRM** action fires the handoff. Sing extends it to stamp
project identity **in the same call** (~1 day of work).

### 8.2 Handoff payload (BuildSuite → GHL Contact)
Written onto the contact at handoff. Field names are the contract.

```json
{
  "buildsuite_project_id": "BSP-2026-000184",   // required, unique, immutable
  "project_name": "string",
  "project_address": "string",
  "contract_amount": 0.00,                        // currency
  "client": {                                     // creates/updates the Contact
    "name": "string",
    "email": "string",
    "phone": "string"
  }
}
```

**Workflow 1 (New Project Setup)** reads these fields and creates the `Project`
record. No other operational data is expected from BuildSuite.

### 8.3 Stage sync-back (GHL → BuildSuite, scheduled)
A scheduled job (target cadence: hourly) reads each project's pipeline stage by
`buildsuite_project_id` and updates BuildSuite's "My Projects" view. Read-only
against GHL; it does not create GHL records.

---

## 9. Security & visibility model

### 9.1 The gate (single rule, enforced at data layer)
```
client_can_see(record) ==
    record.Client Visible == Yes
    AND record.Manager Approval == Approved            (where applicable)
    AND Project.Client Portal Enabled == true
    AND requesting_contact is associated with record.Project
```
Every client-facing query MUST filter by the signed-in contact's associated
project(s). No cross-project leakage.

### 9.2 Authentication tiers
| Action class | Allowed with email + Project ID? | Requires GHL portal login |
|---|---|---|
| Locate/lookup a record | Yes (convenience only) | — |
| View read-only approved summary | Yes (read-only) | — |
| Approvals (change order, selection) | **No** | **Yes** |
| Payments / invoices | **No** | **Yes** |
| Contracts / documents | **No** | **Yes** |
| Private messages | **No** | **Yes** |
| Warranty records | **No** | **Yes** |

### 9.3 Field deny-list — **never** serialized into any client response
`Internal Notes` · `Vendor Cost` · `Internal Labor Cost` / `Labor Cost` ·
`Estimated Cost` / `Original Estimate` · `Markup` / `Internal Markup` ·
`Margin` · `Profit` · `Contingency` · `Private Team Messages` ·
`Internal Risk Assessment` · `Delay Reason` · `Internal Priority`.

**Client-visible financial fields (allow-list):** Contract Amount/Price ·
Allowance · Upgrade · Credit · Approved Change Orders · Pending Change Orders ·
Invoice Amount / Amount Invoiced · Amount Paid · Remaining Balance ·
Next Payment Amount · Next Payment Due Date. (Still gated by
`Show Budget to Client` / `Show Detailed Pricing`.)

### 9.4 Field-role restrictions — field users MUST NOT see
Contractor profit · markups · internal financial reports · client payment
details · unassigned projects · private client messages · employee records ·
company-wide administration.

---

## 10. Publishing / approval state machine (`Daily Update`)

```
[Field: Save Draft] ──► DRAFT
        │
        │ Submit to PM  (Workflow 3)
        ▼
     PENDING  ── Manager Approval Status = Pending
        │                         │
        │ PM: Return for Revision  │ PM: Approve Internally
        ▼                         ▼
     RETURNED ──► (back to DRAFT)  APPROVED INTERNALLY  (Client Visible stays No)
        │
        │ PM edits Client Summary, then Approve & Publish  (Workflow 4)
        ▼
   APPROVED & PUBLISHED
        → set Client Visible = Yes
        → publish Client Summary (never Internal Notes)
        → set Project.Last Updated Date
        → notify client
        → add to Client Portal feed
```

**MUST NOT** publish `Internal Notes` to the client under any path. The field
app surfaces two separate text areas — `Internal Field Notes` and
`Suggested Client Progress Summary`; only the latter is ever a publish candidate.

---

## 11. Workflows (canonical behavior)

Triggers/actions are the contract. Build workflows 1–2 in Phase 2; 3–8 as their
phases arrive.

**WF1 — New Project Setup.** Trigger: Opportunity → `Estimate Approved` (or
project created). Actions: create/update `Project`; associate Contact;
associate Opportunity; assign PM; create default milestones; create default
tasks; set Progress = 10%; internal notification; prepare Client Portal access;
record activity.

**WF2 — Project Stage Sync.** Trigger: Opportunity stage change. Actions: find
associated `Project`; update Project Stage; update Progress Percentage; set
Current Milestone; set Next Milestone; notify assigned team; notify client
**only when appropriate**.

**WF3 — Field Update Submitted.** Trigger: `Daily Update` created. Actions: set
`Manager Approval Status = Pending`; notify PM; add to dashboard review queue;
if blocker → create Issue; if client decision needed → create client-action
item; **do not notify client**.

**WF4 — Field Update Approved.** Trigger: `Manager Approval Status = Approved &
Published`. Actions: set `Client Visible = Yes`; publish Client Summary; update
`Project.Last Updated Date`; notify client; add to portal feed.

**WF5 — Selection Approval.** Trigger: Selection status → Approved. Actions:
record approval date; notify PM; update related task; update upgrade/credit
amount; create Change Order when required; clear client-action alert.

**WF6 — Change Order Approval.** Trigger: Change Order → Approved. Actions:
record approver + date; update `Approved Change Orders`; recalculate
`Current Project Total`; adjust completion date when required; create invoice
when configured; notify PM; notify accounting; update portal.

**WF7 — Issue Submitted.** Trigger: `Project Issue` created. Actions: assign
issue number; notify PM; confirm to reporter; create task when required;
escalate urgent safety concerns; update issue dashboard.

**WF8 — Project Completed.** Trigger: Project Stage → Completed. Actions: set
Progress = 100%; open final documents; send final invoice; create punch-list
review; deliver warranty info; set warranty dates; request client review; move
project into Warranty phase.

---

## 12. Experience specifications

### 12.1 Contractor Dashboard  (`/dashboard`) — build **1st**
Desktop-first, responsive. Roles: owners, office admins, PMs, estimators,
designers. It is the operational control center — it **creates and controls**
everything the other two experiences display.

**Phase-3 initial screens (build these only):** Portfolio Overview · Projects
List · Project Overview · Project Timeline · Daily Update Review · Client
Visibility Settings.

**Full navigation (later):** Portfolio Dashboard · Projects · Schedule · Tasks ·
Field Updates · Clients · Designs & Selections · Estimates & Budget · Change
Orders · Documents · Issues · Messages · Invoices & Payments · Punch List ·
Warranty · Reports · Settings.

**Field Update Review actions (verbatim):** Approve and Publish · Approve
Internally · Edit Client Summary · Return for Revision · Create Issue ·
Create Task · Notify Client. (Maps to §10.)

**Client-visibility controls** — every contractor-created item that can appear in
the portal MUST carry: `Client Visible` · `Client Summary` · `Internal Notes` ·
`Publish Date` · `Notify Client` · `Client Action Required`.

### 12.2 Field Interface  (`/field`) — build **2nd**
Mobile-first, minimal typing, large tap targets, bottom nav. Roles:
superintendents, crew leaders, technicians, subs, approved field users.
**Submits only — never publishes to the client.**

**Nav:** Today · Projects · Tasks · Add Update · Report Issue · Messages · Profile.

**Phase-5 minimal build:** assigned projects · today's tasks · start/complete
task · daily update form · photo upload · report issue · submit to PM.

**Visibility:** field users see **only assigned projects** and are bound by §9.4.
The daily update form ends in two text areas — Internal Field Notes and Suggested
Client Progress Summary — with `Save Draft` and `Submit to Project Manager`
(no auto-publish).

### 12.3 Client Portal  (`portal.<domain>`) — build **3rd**
Built last; depends on contractor-approved content. The existing AI Studio
prototype is close to the target. Roles: homeowners/owners/investors.

**Prototype already has:** action-required queue · change-order cards (cost +
schedule impact) · client-safe budget summary · daily updates with acknowledge
& comment · working mobile navigation.

**Must add:** real GHL authentication · live project data · project filtering by
signed-in contact · project switcher (multi-project clients) · wired approve /
message buttons · native GHL invoice/payment routing (`Pay Now`).

**Native GHL vs AI Studio split:** route contracts, estimates, invoices,
receipts, payments, and document uploads through **GHL's native Client Portal**;
use the AI Studio experience as the richer project-tracking layer with secure
links into the native financial/document functions.

**Phase-1 client screens (demoable core):** Project Overview · Project Stage ·
Progress · Current Milestone · Upcoming Schedule · Recent Updates.

---

## 13. Live-data contract (AI Studio ↔ GHL)

- AI Studio renders; GHL holds truth (records, stages, approvals, notifications,
  documents, payments, permissions).
- Every client-facing read passes through the §9.1 gate **server-side / at the
  data layer** — the UI must never be the only enforcement.
- Test B (§15) is the canonical proof that a live GHL field
  (`Progress Percentage`) flows into the AI Studio surface and updates on change.

---

## 14. Phase → deliverable map (build order)

| Phase | Deliverable | Depends on | Owner |
|---|---|---|---|
| **0** | Validation sprint: Test A + Test B (§15) | environment + tier checks | Chris + Pat |
| **1** | `Project` object (demoable-core fields) + `BuildSuite™ Project Lifecycle` pipeline + core associations | Phase 0 pass | Chris + Pat |
| **2** | WF1 + WF2; Send-to-CRM handoff extension; hourly stage sync-back | Phase 1 | Dale (WF), Sing (handoff) |
| **3** | Contractor Dashboard: Portfolio Overview + Projects List + Project Overview wired to real data | Phases 1–2 | Chris + AI Studio |
| **4** | Native Client Portal enabled + prototype connected (auth, live data, filtering, switcher, native invoicing) | Phase 3 | Chris + Pat |
| **5** | Field Interface (minimal) + WF3/WF4 + remaining Version 1 items | Phase 4 | All |
| **6** | Snapshot deployment package; validate in Alliance Pro Services; distribute per sub-account | Phases 1–5 | Chris + Pat |

**Demoable slice = Phases 0→4** (Steps 1–6 of the build order): sign a proposal
in BuildSuite → project appears → stage moves → client sees progress.

**Version scope**
- **V1:** overview · stages · schedule · tasks · daily updates · photos ·
  documents · client messages · issues · basic financial summary.
- **V2:** design versioning · material selections · digital approvals · change
  orders · detailed budget · advanced scheduling · field time tracking.
- **V3:** vendor access · subcontractor portal · warranty center · automated
  health scoring · AI client summaries · predictive delay alerts · AI project
  assistant · cross-project analytics.

**Deployment package (Phase 6) contents:** custom objects · custom fields ·
pipeline · workflows · forms · calendars · document/contract templates · email
templates · SMS templates · AI Studio experiences · Client Portal settings ·
contractor roles · field-team roles · notification logic · sample project ·
test contacts.

---

## 15. Phase 0 gates (go / no-go — run before any Phase 1 build)

**Prerequisite checks (do first):** confirm on the *contractor sub-account tier*
(not just agency view) that Custom Objects are available, the native Client
Portal is available, and snapshots carry custom objects/fields/associations.

**Test A — Snapshot transfer (~10 min).** Create Custom Object
`BuildSuite Test Project` (fields: Project Name, BuildSuite Project ID, Progress
Percentage, Project Stage, Client Visible; one association → Contact). Add to
master build sub-account → snapshot → push to test sub-account → confirm object,
fields, associations transfer intact and workflows can reference it.
- **Fail →** replace snapshot distribution with a per-account setup script /
  manual deployment checklist (revise §14 Phase 6).

**Test B — AI Studio live data (~1 hr).** Create one record
(`Johnson Kitchen Remodel`, `BSP-TEST-001`, Progress 62, Stage `In Progress`,
Client Visible Yes). Wire `Progress Percentage` into the AI Studio prototype;
update 62 → 70; confirm the dashboard reflects the change live.
- **Fail →** rethink live-data wiring before building any client-facing screens.

**Both pass →** proceed to Phase 1.

---

## 16. Open decisions — do NOT assume; flag and ask

| # | Decision | Impact | Recommendation |
|---|---|---|---|
| D1 | Client Portal packaging: paid add-on vs bundled in higher tiers | per-sub-account gating logic | resolve before Phase 4 |
| D2 | Master key = BuildSuite Project ID | schema everywhere | confirm (recommended yes) |
| D3 | Dedicated build sub-account + token | clean snapshot source | confirm so token can be set up |
| D4 | Plan-tier availability (Custom Objects + native Portal on contractor tier) | can block everything | confirm in §15 prerequisites |

If any decision above is unresolved when its dependent code is reached, **stop
and ask** rather than choosing a default.

---

## 17. Glossary

- **Handoff** — the Send-to-CRM event that moves a signed project from BuildSuite
  into GHL (§8).
- **The gate** — the §9.1 rule governing all client-facing reads.
- **Snapshot** — GHL packaging mechanism used to replicate the whole system into
  contractor sub-accounts (§14 Phase 6).
- **Demoable slice** — Phases 0→4; the minimum that proves the end-to-end chain.
- **CV field** — a field eligible to reach the client *only* if its record passes
  the gate (§6 legend).
