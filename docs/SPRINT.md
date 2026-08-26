# Refreshed phasing, and the one-week sprint

**Date:** 2026-08-22 · **Sprint:** Mon 25 Aug → Fri 29 Aug
**Source of truth:** the four documents reconciled in [`SOURCE-OF-TRUTH.md`](SOURCE-OF-TRUTH.md)

---

## 1. Why the phasing changes

The old plan (`KICKOFF.md`) was built to a three-week window that has closed, and it sequenced
work by *screen*. The adopted documents sequence by **proving the data chain**, and D1 is blunt
about it: *"we should not start by building all three portal interfaces in full."*

We have partly done the thing D1 warned against — thirteen portal screens exist and eleven are
real, while the GHL half of the chain has never been read once. That is not wasted (the client
meeting demanded those screens, and they are what repaired it) but it does mean the remaining
work is **almost entirely chain work, not screen work**.

So the phases are re-cut around what is actually left.

---

## 2. Refreshed phases

| Phase | What it proves | Owner | State |
|---|---|---|---|
| **P0 · The gate** | Alliance sub-account tier supports Custom Objects | Chris + Pat | **Blocking everything** |
| **P1 · Go/no-go tests** | Snapshot carries a custom object; Hub can read one live | Chris + Pat | Not started |
| **P2 · The three wires** | Integration token · object key · **webhook secret** | Pat → Dale | Token + key identified, secret unbuilt |
| **P3 · Handoff & mapping** | BuildSuite stamps identity; shared key lands both sides | Sing | Blocked on C-3 |
| **P4 · Hub reads GHL** | Operational state comes from GHL, not fixtures | Dale | Blocked on P2 |
| **P5 · Field interface v1** | Mobile-first, assignments, notifications | Dale | v0 built, gap listed |
| **P6 · Client login** | Verification link authenticates; no ID-only access | Dale | Blocked on C-2 |
| **P7 · Money** | Payments rail wired | Dale | Blocked on C-4 |
| **P8 · Warranty & completion** | Last portal screen | Dale | Unblocked |
| **P9 · Snapshot package** | One build, every contractor sub-account | Chris + Pat | After P1 |

**What changed from the old plan:**

- **Deleted:** the `hub_*` operational tables as designed. GHL owns those records (C-1). The
  migration shrinks to the Hub's own decisions plus media.
- **Added:** P2's webhook secret. D4 §3 is the only document that says it plainly — *"custom
  values alone do not trigger anything"* — and nothing in our build verifies a webhook today.
- **Promoted:** P0 above everything. D3 and D4 both name it the gate; we have been building
  past it.
- **Demoted:** more portal screens. Two placeholders remain and one of them (Payments) must not
  be built until C-4 is decided.

---

## 3. The sprint — Mon 25 → Fri 29 Aug

Five days, ~40 hours. **Every item is unblocked**, deliberately: four decisions are outstanding
and none of this waits on them. Where a decision would change the work, I build the half that is
true either way and stop at the seam.

### Monday · Correct the foundation (8h)

| | h |
|---|---|
| Shrink `0001_hub_tables.sql` to Hub-owned records + media (C-1). Drop the eight tables GHL owns. | 3.0 |
| Rewrite the ask to Sing/Pat against the corrected set — smaller, and easier to say yes to | 1.0 |
| Guardrail tests for the four D4 rules: no Hub-originated stage completion, no field→GHL path, no title-keyed matching, publish is the only Hub-owned write | 3.0 |
| Carry the D4 rules into `CLAUDE.md` | 1.0 |

**Ships:** a migration that matches the source of truth, and tests that fail if anyone drifts
from it. The migration is unrun, so this correction is free today and expensive next week.

---

### Tuesday · The third wire (8h)

| | h |
|---|---|
| Webhook receiver: `POST /api/ghl/webhook`, signature verification against the shared secret, replay rejection | 4.0 |
| Refuse-by-default when the secret is absent — an unverifiable webhook is not a webhook | 1.5 |
| Route verified events into the existing WF planners (stage change → WF2, custom-object change → the right planner) | 2.5 |

**Ships:** the piece D4 §3 says makes triggers actually fire. Testable end to end with a fake
signed payload today, and live the hour Pat hands over the secret.

**Why this before P4:** reading GHL is a one-afternoon config step once the key exists (D4 §7).
Verifying that GHL is really the one calling us is the part that needs building.

---

### Wednesday · Field interface to spec (8h)

D4 §5 asks for four things ours lacks. Nothing here is blocked.

| | h |
|---|---|
| Mobile-first pass: bottom nav, large tap targets, auto-save indicator, success confirmation | 3.0 |
| Task assignment + notification — *"contractor can assign tasks in the notes; the field person gets a ding"* | 2.5 |
| Conversations: message the PM, ask a task question, request clarification (D2 Step 3) | 2.0 |
| Assert the §9.4 restriction in a test: no profit, markup, payment detail, or unassigned project ever reaches a field session | 0.5 |

**Ships:** the field crew's experience at v1, and the one role that never touches GHL.

---

### Thursday · Client login mechanics (8h)

C-2 is undecided, so I build **the half that is true under either answer**: the token.

| | h |
|---|---|
| Single-use, expiring, signed verification tokens — issue, verify, burn | 3.0 |
| The `/verify` landing: token → session, using the same signed cookie the contractor path uses | 2.5 |
| Email + project ID as a **lookup only** — proves the record exists, mints nothing (D3 §6) | 1.5 |
| Tests: an expired token fails, a reused token fails, a project ID alone gets nothing | 1.0 |

**Ships:** a working magic-link flow. If Chris confirms C-2, it goes live as-is. If he wants
something different, the token machinery is still what any answer needs.

**Not built:** the Alliance-branded front door itself. That is a separate surface and I would
rather ask than assume where it lives.

---

### Friday · Completion & Warranty, then close (8h)

| | h |
|---|---|
| Completion & Warranty screen — punch list, warranty dates, final documents (§6.9, D2) | 3.5 |
| Wire it to WF8, which already exists and is tested | 1.0 |
| Full pass: 240+ tests, build, a walk of all thirteen portal screens against the gate | 1.5 |
| Update the demo HUD — twelve of thirteen screens real, one placeholder | 1.0 |
| EOD + the decision list for Chris | 1.0 |

**Ships:** twelve of thirteen portal screens real. Payments is the only placeholder, and
deliberately so.

---

## 4. What the sprint does not touch, and why

| Not doing | Why |
|---|---|
| Payments screen | C-4 undecided. Building it against the wrong rail wastes the whole day. |
| Reading GHL custom objects | Needs the object key and P0's answer. Config, not build. |
| BuildSuite → GHL mapping | Sing's, and blocked on C-3. |
| Running the migration | Needs the service-role key and sign-off. Ours to hand over, not to run. |
| The Alliance branded front door | Undecided where it lives. Asking beats assuming. |

---

## 5. What I need, and by when

**From Chris — Monday, so the week is not spent hedging:**

1. Verification link is the credential (C-2) → unblocks Thursday shipping live rather than staged
2. Shared key: BuildSuite ID or GHL opportunity id (C-3) → unblocks Sing
3. Payments rail: GHL native or Stripe (C-4) → unblocks the last screen
4. Media: contractor's GHL storage or Supabase → unblocks uploads

**From Chris + Pat — this week, ideally Monday:**

5. **Does the Alliance sub-account tier support Custom Objects?** The gate. Ten minutes to check
   and it decides whether the operational model in every one of these four documents is
   available to us at all.
6. The two go/no-go tests (D1 §3, D3 §5) — ~10 minutes and ~1 hour
7. The three wires: integration token, object key, webhook secret

**From Sing:**

8. The Send-to-CRM extension stamping project identity, once C-3 names the key. He scoped it at
   about a day.
9. The client-to-contractor matching — still what stops us filtering the project list to signed
   work only.
