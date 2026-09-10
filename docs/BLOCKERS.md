# Blockers

**The standing list.** A blocker is something that **cannot be resolved by the
person who found it** — it needs a decision, a credential, another team, or an
action on a live system. Anything you could sit down and fix is a task, not a
blocker, and does not belong here.

Every row names **who it waits on** and **since when**. An item with neither is
not tracked, it is filed.

`npm run checkin` copies every 🔴 row into that day's check-in in full, and
carries the 🟡 rows as a count with a link back here — so a red blocker sitting
for a week becomes impossible to miss, without burying the check-in in a table.

---

## Open

| | Blocker | Waiting on | Since | Cost of leaving it |
|---|---|---|---|---|
| 🔴 | **Rotate four secrets** — `SESSION_SECRET`, GHL PIT, Supabase `service_role`, Supabase anon. Do `service_role` first: it bypasses RLS, and RLS is off on the Hub. | John | 2026-08-31 | `SESSION_SECRET` signs every session cookie. Anyone holding the old value can forge one. |
| 🔴 | **GHL webhook secret** does not exist, so no real webhook has ever been received. | GHL admin | 2026-09-03 | Every event name in `webhook-routing.ts` is inferred. WF1–WF8 cannot be triggered by GHL at all. |
| 🔴 | **`GHL_PROJECT_OBJECT_KEY`** is unset, so the Project custom object cannot be read. | GHL admin | 2026-08-26 | The handoff cannot be verified end to end. `canReadProjectObject()` reports false. |
| 🟡 | **GHL's `custom_objects.projects` keys on a UUID, not the BSA code** (C-3). Chris and that record disagree. | Chris + Sing | 2026-09-01 | A handoff will not join. **Do not resolve by also accepting UUIDs** — that makes the join key "any string". |
| 🟡 | **Milestone status has no vocabulary.** §6.2 says `Status (select)` and never lists the values, unlike §6.3 for tasks. | Chris | 2026-09-10 | The column is unconstrained text and `updateMilestone` takes any string. See `REVIEW-MILESTONES-AND-TASKS.md` §2. |
| 🟡 | **Where client messaging lives** — GHL conversations, or a `hub_messages` table. | Chris | 2026-09-10 | `/portal/messages` renders fixtures and its buttons do nothing. See `MESSAGING-HUB-AND-GHL.md` §6. |
| 🟡 | **`NotifyClient` only logs.** Needs a `ghlPorts` module and a template per notification. | needs a decision on which notifications email at all | 2026-09-10 | A PM publishes an update and the homeowner is never told. Nothing on screen says so. |
| 🟡 | **Homeowner login pushback** — Chris raised a concern and it was never answered. | Chris | 2026-09-08 | The code-as-password flow shipped 2026-09-10 without that being closed. |

## Data gaps — BuildSuite side, all fail closed

| | Gap | Waiting on | Since | Effect |
|---|---|---|---|---|
| 🟡 | **9 of 68 accounts** on this location do not resolve to a contractor record. | Sing | 2026-09-10 | Those users see "not linked to a contractor" on every Hub-backed screen. |
| 🟡 | **`proposals.contractor_id` null on 13 of 48**, including one of the six signed. | Sing | 2026-09-10 | Worked around via `ContractorResolver`, but the fallback costs a read and covers a gap that should not exist. |
| 🟡 | **`BSA-028` has a code but no `client_email`.** | Sing | 2026-09-10 | Its homeowner can never sign in. Nothing else is affected. |
| 🟡 | **51 live projects have no `project_code`.** | Sing | 2026-09-10 | They cannot hand off (§3.6) and their homeowners cannot sign in. Codes appear to be assigned at award or signature. |

---

## Recently cleared

Kept for a fortnight, then deleted. Seeing what unblocked and how long it took
is the only way to know whether this list is working.

| Cleared | Was |
|---|---|
| 2026-09-10 | **Migration `0009_selections_change_orders.sql`** — believed outstanding; found already applied. `hub_selections` and `hub_change_orders` both exist. |
| 2026-09-10 | **The BuildSuite signature automation** — believed outstanding; it was already live and firing after signature. |
| 2026-09-10 | **Migration `0008_invoice_rail.sql`** — run and verified against the live database. |
| 2026-09-09 | **Signed test record with a real total** — Sing built `[HUB TEST] Kitchen remodel` (`BSA-052`) to spec. |

---

## How to use this

- **Add a row the moment you are stuck**, not at the end of the day. The point
  is that somebody else sees it while they can still act on it.
- **🔴 means someone cannot work, or something is unsafe.** 🟡 means it has a
  workaround and a cost. There is no green — that is what "closed" is for.
- **Move a row to *Recently cleared* rather than deleting it.** How long things
  take is the useful number here, and it is invisible if rows just vanish.
- **If a row has been open more than a week, escalate it in the check-in** by
  name. A list nobody escalates from is a list nobody reads.
