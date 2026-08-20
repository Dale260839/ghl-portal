# Who signs in, and how — the three identity paths

**Date:** 2026-08-20
**Status:** proposal, needs a decision before any of it is built

Auto-login via GoHighLevel works, but it authenticates a **sub-account**, not a
person. That is fine for the contractor's office and wrong for everyone else.
This sets out the gap and the fix.

---

## 1. The gap, stated precisely

Today a GHL menu link hands us `locationId`, we verify it, and we issue a session
scoped to that agency. That means:

**Everyone who arrives is the agency.** We don't know *which* person, only which
company. Three consequences, and the third is the one that bites:

1. **Field users can't be restricted.** §9.4 says a field user sees only their
   assigned projects and never profit, markups, or client payment details. We
   cannot enforce that when the session says "Alliance For Contractors" rather
   than "Tony Alvarez".
2. **Clients have no path at all.** Homeowners don't have GoHighLevel logins.
   There is currently no way for one to sign in.
3. **No action is attributable to a person.** §10 and §12.1 assume a named
   project manager reviews and publishes. Right now every GHL session is
   anonymous within the agency, so "who approved this and sent it to the client"
   has no answer. For a system whose core promise is a review step before
   anything reaches a homeowner, **an unattributable approval is a real problem** —
   it is the one record you would want if a client ever disputed what they were
   shown.

Point 3 applies to contractors too, so this is not only about the other two
roles.

---

## 2. The proposal

**Three paths, one session model.**

| Who | How they sign in | Scoped to |
|---|---|---|
| **Contractor office** — owners, PMs, admin | GHL menu link, as today | The whole agency |
| **Field** — superintendents, crew, subs | **Invited by email, set their own password** | Only their assigned projects (§9.4) |
| **Client** — homeowners | **Invited by email, set their own password** | Only their own projects, through the §9.1 gate |

This is the right shape. Contractors already live in GHL and shouldn't need a
second password; field crews and homeowners don't and can't.

**One addition to what you described:** the GHL path should also identify the
*person*, not just the agency. GHL menu links can carry `{{user.email}}` alongside
the location — if that merge field substitutes (the location one didn't, so it
needs testing), we can attribute actions properly. If it doesn't, contractor
staff need invitations too, and GHL sign-in becomes a convenience layered on top
of a real account rather than the account itself.

---

## 3. What invitations require

Not a small feature. Listed honestly:

- **A users table** — email, name, role, tenant, hashed password, status
- **Invitation tokens** — single-use, expiring, revocable
- **Password rules** — hashing, strength, reset flow, lockout on repeated failures
- **An invite screen** for contractors to send them, and an accept screen
- **Tenant scoping on every invitation** — a contractor invites *their* field
  users and *their* clients, never anyone else's
- **Client invitations must link to a GHL contact**, because the §9.1 gate
  resolves a client's projects through `contactId`. An invitation that doesn't
  carry it produces a homeowner who can log in and see nothing.

---

## 4. The decision worth making first

**Build password auth ourselves, or use Supabase Auth?**

| | Ours | Supabase Auth |
|---|---|---|
| Hashing, reset, lockout, sessions | We write and maintain it | Provided |
| Email invitations | We build sending + tokens | Built in |
| Time | ~2 days, and it is security-critical code | ~half a day |
| Risk | Every auth bug is ours | Battle-tested |

**Recommendation: Supabase Auth.** Password storage and reset flows are exactly
the code you don't want to be the author of, and we already use Supabase.

**But it forces a second decision.** Supabase Auth is per-project, so using
BuildSuite's project would put *our* users into *their* `auth.users` table. That
is a bigger intrusion than the `hub_` tables — those are additive and ignorable;
auth users are not.

**So: the Hub should get its own Supabase project.**

- Its own `auth.users` — our users, our problem, no entanglement
- Its own `hub_` tables, moved out of BuildSuite's database entirely
- BuildSuite's Supabase stays **read-only**, exactly as the standing guardrail
  says, with no new tables in it at all

That is cleaner than D-014 and costs nothing extra — a free Supabase project and
one more connection string. It also removes the dependency on Sing running our
migration, which is currently blocking the `hub_` tables.

**I'd revise D-014 on those grounds.** Worth your call, since it changes what we
ask Sing for.

---

## 5. Timing — the honest version

This is **1.5–2 days of work**, and there are **two working days left** before
the 21st.

Building it now means **not** building Phase B — the Designs & Selections, Change
Orders, Issues and Budget screens the client is expecting after the last meeting.

| Option | By Friday |
|---|---|
| **Phase B** | All twelve portal screens real. Contractors sign in via GHL. Field and clients still use demo accounts. |
| **This** | Real accounts for everyone. Portal still shows four placeholders — the ones the client already flagged. |

**My recommendation: Phase B first, this immediately after.** The client's stated
complaint was missing screens; nobody has yet asked how a homeowner signs in. And
the demo accounts already show the field and client experiences convincingly.

**With one exception.** If any real homeowner or field crew is going to touch this
before the invitation flow exists, then it goes first — because the alternative is
either shared credentials or no access, and shared credentials in a system built
around per-person approval would undo the point of it.

---

## 6. What I need decided

1. **Phase B first, or this first?**
2. **Own Supabase project for the Hub** — yes or no? (Recommend yes; it also
   unblocks the `hub_` tables without waiting on Sing.)
3. **Does `{{user.email}}` substitute in a GHL menu link?** Worth testing while
   you're in there — it decides whether contractor actions can be attributed to a
   named person or whether staff need invitations too.
