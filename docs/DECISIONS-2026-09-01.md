# Chris's four answers — what each one unblocks, and one I need to push back on

**Date:** 2026-09-01 · **From:** Dale
**Source:** Chris, Slack, in reply to the Project Hub briefing

Three of the four are answered and I can act on them today. One needs a short
conversation before it is built, because as written it makes the homeowner login
weaker than the one already in the code.

---

## 1. The shared key — CONFIRMED, and the data agrees

> *"I think it's project_code (the BSA number). Confirm? It's populated on half
> the projects already."*

**Confirmed, and your recollection of the coverage is exact.** Measured on the
live database this morning:

| | |
|---|---|
| Projects | 101 |
| With a `project_code` | **48** — half, as you said |
| Format | `BSA-NNN`, uniformly. No other shape |
| Duplicates | **none** — all 48 are unique |
| Range | BSA-001 to BSA-048, sequential |

This closes open decision **C-3**, which has been blocking Sing since 2026-08-20.

**One change it forces on our side, and it is small.** The architecture document
specifies the key as `BSP-YYYY-NNNNNN`, and our code validates against that
pattern — so today a handoff carrying `BSA-002` would be rejected. That was
always a documented format nobody had implemented; `project_code` is a real
column with real values. We change the pattern to match reality. Half a day,
and it is ours, not Sing's.

**What Sing needs to settle, and you flagged it yourself:** who assigns the
code. You mentioned wanting Supabase to assign project IDs so there is no
disconnect. I agree, and the reason is the 53 projects that have no code: if the
database assigns it on insert, that gap closes permanently and nothing downstream
has to cope with a project that has no key. If it stays application-assigned,
the gap can reopen any time somebody creates a project by another path.

**Also worth knowing:** the one genuinely signed project in the database is
hidden from our key by row-level security, so I cannot see whether it has a
code. Worth checking before the pilot, since that is the row a pilot would most
likely touch.

---

## 2. Photos and documents — CONFIRMED, Supabase

> *"I am ok with what Sing says. If it is ok on Supabase I think that would be
> the cleanest."*

**Agreed, and it is cleaner for a reason worth stating.** GoHighLevel media
would put client photos behind a system the field crew is never allowed to touch
and whose object model we still cannot read. Supabase Storage sits beside the
records that reference it, in the database the Hub already owns.

This unblocks uploads. Nothing else is waiting on it.

---

## 3. Payments — I need one fact before you decide

> *"I think we should use Stripe, but we could discuss this if GHL invoicing
> would fire the invoices based off of the workflows."*

That is exactly the right question and I do not want to answer it from memory.
GoHighLevel does have invoicing and does have workflow actions, but whether a
workflow can *create and send* an invoice depends on the sub-account tier and on
which API the integration token can reach — the same tier question that is
already open with Pat.

**Let me check it properly and come back with a yes or no**, rather than guess.
It is an hour of work against the live account.

**What I would say in the meantime.** If GHL invoicing does fire from workflows,
it is the better answer: the invoice lands where the rest of the operational
record already is, and there is no second system holding money data. If it does
not, Stripe is straightforward and we would trigger it from the same workflow
that would have triggered GHL.

Either way the screen is deliberately unbuilt, so nothing is wasted by waiting a
day.

---

## 4. The homeowner login — this is the one I want to push back on

> *"Yes homeowners need their emails and project code to enter (given by the
> assigned/awarded contractor). I just need it in writing that a project number
> alone never opens the door."*

**The second sentence is already true and I can put it in writing: a project
number alone opens nothing.** That is built and tested.

**But email plus project code, as the whole credential, is weaker than what is
already in the code, and I do not think it is what you actually want.**

Here is the arithmetic. Project codes are `BSA-001` through `BSA-048`,
sequential, with no gaps. So the "secret" half of that pair is a number between
1 and 48. Someone who knows a homeowner's email address — which is not secret,
it is on every email they have ever sent — can try all 48 codes in under a
minute and read that homeowner's project: their budget band, their schedule,
their documents.

It also cannot be revoked. If a code reaches the wrong person there is nothing
to turn off, because the credential *is* the project's identity.

**What is already built instead.** The contractor invites the homeowner by
email. They get a single-use link that expires, they set their own password, and
from then on they sign in with email and password like anything else. The
contractor can revoke them in one click. That is live now — I created and
revoked a test homeowner this week to prove it end to end.

**Where I think we actually agree.** Your requirement, as I read it, is that the
contractor controls who gets in, and that a homeowner does not need to be set up
in GoHighLevel first. Both are true of the invitation flow. The difference is
only in what the homeowner holds afterwards: a password they chose, rather than
a code that is also printed on their paperwork.

**If you want the project code in the flow anyway**, the safe version is to use
it as a second factor at invitation time — the emailed link asks for the project
code before it lets someone set a password. That gives you the "they need their
code" property without the code being a standing password. Happy to build that;
it is a small addition.

**What I need from you:** a yes to the invitation flow, or a conversation. It is
the only one of the four I have not acted on, and it is the only one where I
think the written answer would make the product worse.

---

## On the pilot

> *"Let me know and when we can set up a real deal and run it thru APS for the
> Pilot entry."*

**Yes, and the system is ready for it in a way it was not last week.** A
contractor can now edit and archive records, invite their crew and their
homeowner, and a field update filed on site persists and reaches the homeowner
only after a person approves it. I seeded a labelled test case this morning so
the screens are not empty while we set it up.

**Three things to line up before a real deal goes through:**

1. **Sing's handoff stamp**, now unblocked by your answer on the key. The spec
   is written and waiting for him in `docs/HUB-API-REQUEST.md`.
2. **Pat's two values** — the Custom Objects tier answer and the webhook secret.
   Without them the chain runs as far as GoHighLevel and stops with a logged
   reason rather than silence.
3. **The homeowner login decision above**, since a pilot means a real homeowner
   signing in.

None of those is more than a day's work for the person holding it.
