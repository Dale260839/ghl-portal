# Source of truth, reconciled

**Date:** 2026-08-22
**Status:** four documents adopted as canonical. Six conflicts found. **Four need Chris to
decide** — they are listed in §2 and nothing in the sprint depends on guessing them.

---

## 0. The document set

| # | Document | Author / date | Role |
|---|---|---|---|
| **D1** | Portal build and validation strategy | — | Integration boundary, build order, the two go/no-go tests |
| **D2** | BuildSuite™ Three-Experience Architecture | — | Objects, fields, pipeline, WF1–WF8, the AI Studio prompts |
| **D3** | BuildSuite Three-Experience Review | **Sing**, 2026-07-17 | Technical sign-off, security guardrails, owner/timeline table |
| **D4** | Project Hub — Build Context & Guardrails | **Chris + Dale huddle**, 2026-08-21 | The privacy model, role separation, system-of-record map |

`docs/ARCHITECTURE.md` v1.0 (2026-07-30) predates D4 and is the transcription these were
built from. **Where D4 and ARCHITECTURE disagree, D4 is newer and wins** — it is the only
document written after the client meeting and after the code existed.

**What all four agree on, and what the repo already does:**

- One shared project record, three controlled views — not three systems
- Contractor dashboard first, client portal last, because the dashboard controls what the
  others display
- `field submits → PM reviews → PM edits the client summary → PM publishes → client sees`
- Internal notes, cost, markup, margin **never** reach a client response
- The portals never talk to BuildSuite continuously; Send-to-CRM is the handoff

D4 §4 rejects the exact pattern we also rejected — fetching a full project and hiding fields at
the display layer, which leaks in the network tab. **Our gate already works the way D4
requires**, and the Phase B projections (a client type with no `actualCost` property at all)
are that rule taken further. That part needs no change.

---

## 1. Conflicts that change what we build

### C-1 · Operational records: GHL owns them — but that is not a schema instruction ⚪ **resolved**

**What I got wrong.** D1 p2, D2 §5, D3 §3 and D4 §2 all say GoHighLevel owns milestones, tasks,
daily updates, selections, change orders and invoices after handoff. I read that as an
instruction about *our database* and cut `0001_hub_tables.sql` from eleven tables to three.

**These documents are requirements, not technical specification.** They define what each role
sees, the privacy rule, the approval flow and the system boundary. Where the Hub stores what it
reads is an engineering decision, and it stays ours.

**The engineering answer is the original one.** GHL custom objects are not reachable: no object
key, and the sub-account tier is unconfirmed. Blocking every client-facing screen on an
unanswered tier question is the wrong trade. So GHL is the system of record; these tables are
the working store until it is reachable, and the migration source when it is. That was D-014 and
it was right.

**Reverted.** The tables are back. Two things from that pass were kept because they were real:

- **`hub_visibility_settings`** — the §6.1 switches had no home at all. The app enforces them, so
  the app should store them.
- **A missing tenancy key.** `hub_update_acknowledgements` and `hub_update_comments` carried
  `project_id` but not `auth_profile_id`, so their tenant was only reachable by joining
  `hub_daily_updates` — while the migration's own rule 4 says every table carries both. Caught by
  a guardrail test, not by anyone reading it.

**Standing correction:** treat the four documents as requirements. When one appears to dictate
an implementation, that is a reading error.

### C-6 · "The Hub owns one write" was a misreading ⚪ **resolved**

**What I got wrong.** D4 §5 says the PM decision buttons *"live in the Hub only — nothing in
GHL … this is the one place the Hub owns the action."* I read that as a hard cap: one write,
everything else read-only.

It means the publish decision is not **duplicated** in GoHighLevel. It does not mean the Hub
writes once. §12.1 says the opposite in plain terms — the contractor dashboard *"creates and
controls everything the other two experiences display"* — and D2 lists create-forms for
projects, milestones, tasks, selections, change orders, issues, messages, punch list and
warranty.

**Resolved as a matrix**, in `lib/permissions.ts`, with four real exceptions:

| | |
|---|---|
| **Contractor** | Full CRUD on every operational record, plus publish and the gate switches |
| **Field** | Creates updates, progresses **its own** tasks, raises issues, uploads photos, messages the PM. Never publishes, never deletes, never sees money |
| **Client** | Approves selections and change orders, comments, messages, raises issues and warranty requests. Never edits terms, never deletes |
| **Nobody** | `completeStage`. GoHighLevel owns stage movement; the Hub reflects it (D4 §5) |

Permission and **ownership** are separate questions and both must pass — "may a field user
update a task" is the matrix, "may they update *this* task" is `ownsTask`. Conflating them is
how a crew member ends up able to close somebody else's work.

**Second instance of the same error.** C-1 was the first. Both came from reading a requirements
document as a technical constraint.

### C-2 · Client login: D4's model is the one the other three prohibit 🔴

**The conflict.**

- **D4 §5:** *"Login via the Alliance-owned branded site: email + project ID + verification
  link."*
- **D3 §6 (Sing):** *"Email plus project ID alone is fine as a lookup convenience but must not
  gate approvals, money, or documents."*
- **D1 p8:** same, listed explicitly — change-order approvals, selection approvals, payments,
  contracts, documents, private messages, warranty records all require authenticated login.

Read carelessly, D4 describes exactly what D1 and D3 forbid.

**Resolution (proposed — Chris to confirm):** they reconcile if **the verification link is the
credential**, not the project ID. Email + project ID *locates* the record; the emailed link is a
single-use, expiring token that *authenticates*. That is a magic link, it satisfies D3's
guardrail, and it is what D4 most likely means.

**What must be true for it to be safe**, and what I will build to:

- The link carries a signed, single-use, time-limited token — not the project ID
- Possession of an email address plus a project ID gets you **nothing** on its own
- The session it mints is the same signed cookie the contractor path already uses
- Approvals, payments and documents check that session, never a URL parameter

**Ask Chris:** confirm the verification link is the credential. If instead he means the project
ID alone admits someone, that is a decision to overrule D1 and D3 and I need it in writing.

---

### C-3 · The shared key — **proposed resolution, 2026-08-28** 🟡

**Measured since this was written:** `ghl_opportunity_id` is empty on **all 182 deals** and all
101 projects. It cannot be the key today.

**The ownership split resolves it.** GoHighLevel ingests the client; BuildSuite matches the
contractor and builds the proposal. So **the project is born in BuildSuite** — it is not a
project until a contractor is matched to a client. Whoever creates a record owns its identifier.

**Therefore: BuildSuite generates the id, GoHighLevel stores and copies it.** That is D4 §6's
first sentence, and it overrules D4 §6's own second sentence naming the GHL opportunity id as
the matching key. The opportunity id stays a useful secondary link on the sales side.

Detail and the measured join chain: `docs/kb/two-system-model.md`. **Chris still confirms**, but
there is now a reasoned default rather than three competing answers.

### C-3 (original) · The shared key: three answers, and the data supports none of them 🟠

| Source | Says |
|---|---|
| ARCHITECTURE §3.6, D1 p8 | BuildSuite Project ID, `BSP-2026-000184` |
| D3 §8 (Sing) | BuildSuite's project ID |
| **D4 §6** | Format `APS-081` — **and** *"cross-system matching uses the GoHighLevel opportunity ID"* |

D4 §6 contradicts itself: a BuildSuite-generated `APS-081` in a dedicated field on both systems,
*and* the GHL opportunity id as the matching key. Those are different keys.

**Measured against the live database (2026-08-20):** there is no `BSP` column and no `BSP-`
value anywhere in BuildSuite's `projects` table. `ghl_opportunity_id` exists **and is empty on
all nine rows** for the Alliance tenant. So today neither candidate carries data.

**Ask Chris — one answer, three consequences:**

1. Which key? BuildSuite-generated ID, or GHL opportunity id.
2. Whoever owns it generates it; the other side copies. D4 §6 is right that a human typing it
   on both sides causes mismatches, and *"a mismatch shows the wrong data on a job site."*
3. It needs a dedicated field on both systems — never the job title.

Until this lands the Hub keys on BuildSuite's own row `id`, which is real and populated. That is
a stopgap and it is marked as one in the code.

---

### C-4 · Payments: GHL native invoices, or Stripe 🟠

- **D1 p28 / D2 Step 4 / D3 §4:** route contracts, estimates, invoices and payments through
  **GHL's native Client Portal**
- **D4 §2:** **Stripe**, connected from each contractor's own account

Different money rails, different contractor onboarding, different failure modes.

**No cost yet:** the Payments screen is still a placeholder, so nothing is wasted either way.
**Do not build it until this is decided.**

---

## 2. What Chris has to decide

Four items. Everything in the sprint is arranged so none of it blocks on them.

| # | Decision | Blocks |
|---|---|---|
| **1** | Verification link is the credential (C-2) | Client login build |
| **2** | Shared key: BuildSuite ID or GHL opportunity id (C-3) | Sing's mapping work |
| **3** | Payments rail: GHL native or Stripe (C-4) | Payments screen |
| **4** | Media storage: contractor's GHL media vs Supabase (D4 §11, still open) | Upload/recall path |

Plus the gate that outranks all of them — **D3 §5 and D4 §7: confirm the Alliance sub-account
tier actually supports Custom Objects.** If it does not, the whole GHL-owned-operations model
changes and C-1 reopens.

---

## 3. Status corrections

**The field interface exists.** D4 §9 lists it as not built; `/field` has been running since
2026-08-13 — today's tasks, the daily update form with the two-box split, submit to PM. What it
does *not* have is what D4 §5 asks for: mobile-first app feel, task-assignment notifications,
and conversations. Treat ours as v0, not as absent.

**The two go/no-go tests from D1 §3 and D3 §5 have not been run**, and they are still the
highest-leverage hour anyone can spend:

- **Test A** — one custom object with fields and an association, pushed through a snapshot to a
  test sub-account. ~10 minutes. The entire per-contractor rollout rides on it.
- **Test B** — one real field wired end to end. We have effectively done the harder half of this
  already: the dashboard reads BuildSuite's live Supabase. What is untested is the **GHL custom
  object** read, which is what Test B is actually about.

Both belong to Chris + Pat per D3 §7.

---

## 4. Standing rules added from D4

Carried into `CLAUDE.md` because they are guardrails, not preferences:

1. **Never let stage "complete" be set from the Hub.** GHL owns stage movement; the Hub
   reflects it. (D4 §5, §10)
2. **Never wire the field crew into GoHighLevel.** They only ever see the Hub. (D4 §5, §10)
3. **Never key cross-system links off a job title.** Dedicated ID field only. (D4 §6, §10)
4. **The Hub owns exactly one action:** the PM's publish decision. Everything else it reflects.
   (D4 §5)
5. **Triggers need a webhook, not custom values.** *"Custom values alone do not trigger
   anything."* Firing = webhook + key. (D4 §3)
