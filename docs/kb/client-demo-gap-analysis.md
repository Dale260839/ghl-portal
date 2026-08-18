# Client demo vs. our system — gap analysis and plan

**Date:** 2026-08-14
**Trigger:** The client reviewed our system against a portal demo and said ours
looked backward.

That reaction is understandable, and this document takes it at face value rather
than arguing with it. It sets out what the demo shows, what we already have, what
is genuinely missing, and how to close it.

---

## 1. The honest read

**The demo has 12 client-facing screens. Our portal has 1.** In a meeting that is
the entire impression, and no amount of architecture explains it away.

What the demo does not have — and cannot, because it is a front end with sample
data written into it:

| | Demo | Ours |
|---|---|---|
| Screens a client sees | **12** | **1** |
| Real data | No | Yes — live BuildSuite projects |
| Sign-in | No | Yes, signed sessions |
| Per-contractor data isolation | No | Yes, enforced at the data layer |
| Internal costs kept from clients | Nothing to enforce | Yes, allow-list + tests |
| Approval workflow behind it | No | WF1–WF4, WF7, WF8 |
| Tests | — | 198 |

**Both halves are real.** They built the half a client can see; we built the half
that has to be right before a real project touches it. The mistake was sequencing
— we built inward-out, and the people judging it only ever see outward.

**The fix is fast**, because screens on top of a working data layer are cheap.
Most of what follows is hours each, not days.

---

## 2. Screen by screen

**Have** = built · **Data** = the model exists in our architecture and code, only
the screen is missing · **New** = not in the architecture at all

| Demo screen | Architecture | Status | Notes |
|---|---|---|---|
| **Dashboard** | §12.3 | **Have** | Progress, stage, milestones, action-required, budget, updates. Missing the 6-step stage tracker and Quick Actions. |
| **Project Timeline** | §6.2 Milestone | **Data** | Held and shown contractor-side. No client screen. |
| **Schedule** | §6.3 Task | **Data** | Tasks carry scheduled date and trade. No client screen. |
| **Daily Updates** | §6.4 | **Data** | Fully modelled, published via WF4. Our client feed is a plain list — no photos, Acknowledge, or Comment. |
| **Designs & Selections** | §6.5 Material Selection | **Data** | Modelled, **V2 in our plan**. No type, no screen. Approve/Reject is WF5. |
| **Budget & Pricing** | §6.1, §9.3 | **Have** (partial) | We show contract, changes, paid, remaining. Missing the per-category Original/Changes/Current table. |
| **Change Orders** | §6.6 | **Data** | Modelled, **V2 in our plan**. Approve is WF6. |
| **Documents** | §6.1, §12.3 | **Data** | §12.3 routes documents through GHL's native portal. The demo puts them in-app. **Decision needed.** |
| **Photos & Videos** | §6.3 Completion Photo | **Data** | Photos attach to tasks and updates. No gallery. *404 in the demo too — not built there either.* |
| **Messages** | §6.8 Project Message | **Data** | Modelled with thread category and client-visible flag. No type, no screen. |
| **Issues & Requests** | §6.7 Project Issue | **Have** (contractor) | Model, fixtures, WF7 and a contractor screen exist. **No client view** — they can't report or track. |
| **Payments & Invoices** | §6.1, §12.3 | **Data** | §12.3 routes payments to **native GHL invoicing**. The demo shows in-app history with Pay Now. **Decision needed.** |
| **Completion & Warranty** | §6.9, §6.10 | **Data** | Both modelled, **V3 in our plan**. The demo is an empty state, so scope is small. |

**Two built, ten modelled but unbuilt.** Nothing in the demo is architecturally
surprising — the model anticipated all of it. The plan simply sequenced it later.

---

## 3. What the demo has that our architecture does not

Real new requirements, not oversights. Each needs a decision.

| Feature | Where | Notes |
|---|---|---|
| **Confirm Access** | Schedule | Client confirms site access per appointment. Genuinely useful — removes a day-of phone call. Not modelled. |
| **Ask Question** (inline) | Schedule, Change Orders | A message tied to one item rather than a general thread. §6.8 already has `Related Task` / `Related Change Order`, so the model supports it. |
| **Sync Calendar** | Schedule | Calendar feed subscription. Not modelled. |
| **Request Change** | Schedule | Client-initiated schedule change. §6.7 has a `Client Request` category — could route there. |
| **Design Layouts** | Designs & Selections | A second tab beside materials, for floorplans. §6.5 covers materials only. |
| **Acknowledge** | Daily Updates | Client marks an update read. §12.3 mentions it; no field exists. |
| **Comment (n)** | Daily Updates | Threaded comments on an update. Maps to §6.8 with a relation. |
| **Confirm Resolution** | Issues | §6.7 has `Client Confirmation` — **already modelled.** |
| **6-step stage tracker** | Dashboard | Planning → Design → Materials → In Progress → Inspection → Completed. |

**The stage tracker deserves attention.** The demo shows **6** steps; our pipeline
has **19**, because contractors need that granularity and clients do not. We need
a documented **19 → 6 mapping** for client display. Small piece of work, large
effect on how the portal reads.

---

## 4. Where the demo would break our own rules

Adopting its scope is right. Adopting it uncritically is not.

**Budget & Pricing** shows per-category figures — *Cabinetry (Allowance) $25,000,
+$3,000 changes, $28,000 current*. Allowances and change amounts are on the §9.3
allow-list, so this is legitimate. But it sits one column away from cost and
markup, which never are. **Every field on that screen gets checked against the
allow-list before it touches real data.**

**Documents and Payments contradict §12.3**, which routes contracts, invoices,
receipts and payments through GHL's **native** Client Portal. The demo puts them
in-app with a Pay Now button. Better experience, bigger build — payments in
particular pull in PCI scope we deliberately avoided. **A decision, not an
oversight.**

**Nothing in the demo is access-controlled**, because there is nothing to control.
Every screen we port goes through the §9.1 gate and the allow-list projection.
Not optional, and not slow — the machinery exists.

---

## 5. The plan

Reordered to put client-visible surface first, because that is what is being
judged and the foundation to support it already exists.

### Phase A — Parity (~2 days)

Every screen exists, no dead links. Fixtures where data isn't wired, bannered.

1. Project Timeline — client view of §6.2
2. Schedule — §6.3, with Confirm Access and Ask Question
3. Daily Updates — rebuilt with photos, Acknowledge, Comment
4. Documents — list and download
5. Photos & Videos — gallery
6. Messages — threaded, §6.8
7. Dashboard — add the 6-step tracker and Quick Actions

*First because it removes the impression in one pass, and none of it waits on a
decision or a credential.*

### Phase B — Approvals (~2 days)

Where the client does something consequential. These need the gate and the
workflows.

8. Designs & Selections + **WF5**
9. Change Orders + **WF6**
10. Issues & Requests — client view: report, track, confirm resolution
11. Budget & Pricing — the per-category table

*Second because it is the highest value per screen, and it completes §11.*

### Phase C — Closeout and money (~1 day + decisions)

12. Completion & Warranty — §6.9, §6.10. Small; the demo is an empty state.
13. Payments — **after** the native-GHL vs in-app decision.

### Phase D — Live data

Swap fixtures for real records as credentials land. **No screen changes** — the
data seam exists and is already tenant-scoped.

**To visual parity: ~4 days. To full parity including approvals: ~5.**

---

## 6. What to tell the client

Not a defence — a plan with a date.

> The portal you saw is the right target and we're building to it. Most of those
> screens are a day or two each, because the data model behind them already
> exists — it was designed from the same specification.
>
> What we built first is the part that can't be added afterwards: real sign-in,
> each contractor seeing only their own projects, and a guarantee that your costs
> and margins never reach a client's screen. The demo can't do those, and
> retrofitting them is the expensive kind of rework.
>
> Every screen will be in place within the week.

**Say one more thing plainly:** if the demo is now the specification, confirm it.
It is a better client experience than §12.3 describes, and building to it
deliberately beats discovering it one screen at a time.

---

## 7. What this changes in our plan

- **V2 becomes V1.** Selections and change orders were staged later; the client
  expects them now.
- **§12.3's native-GHL split needs revisiting** for documents and payments.
- **Client-facing screens lead, backend follows** — the reverse of how we have
  been sequencing. The foundation is now solid enough to support that.
- **The 19 → 6 stage mapping** joins W1–W3 as something only the client can
  confirm.
