# Security and data audit — 30 September 2026

**Asked for:** exposure, security holes, API abuse, features needing
refinement, and any placeholder data still showing as real — with the **crew
field view** and the **client side** looked at hardest.

**Method:** read the code and measured where measuring was possible. Nothing
below is a guess; where I could not test a thing, it says so.

---

## 1 · Fixed today

### 1.1 The contractor's dashboard showed invented change orders — **live, every day**

`app/dashboard/page.tsx` computed "open change orders", the money **waiting on a
client**, and part of the activity feed from `portal-fixtures.ts`.
**Unconditionally — not a fallback.** The real rows in `hub_change_orders` were
never read on that screen.

So the first thing a project manager saw each morning included a money figure
that was fiction. The per-project Change Orders screen has always read the real
table, which is how this survived: the two screens disagreed and nobody had
reason to compare them.

**Fixed.** Added `listAllChangeOrders(scope)` and the dashboard reads it. Empty
when the Hub is unreachable, because a number invented to fill a tile is how
somebody chases a client about a change order that does not exist.

### 1.2 A crew member could fetch any of their contractor's files — **authorization gap**

`/api/files` checked the **tenant** and nothing else. A crew member holding any
file id belonging to their contractor could fetch it:

- a **signed contract**, with its pricing;
- a file on a **project they were never assigned to**;
- a document in the **Client folder**.

Their own screens enforce both rules — assigned projects, and field folders only
— but a screen is not a permission, and this is a `GET` anybody can construct.

Ids are uuids, so it was never enumerable. That makes it the quiet kind: **a
link that keeps working after somebody is taken off a job.**

**Fixed**, on both ways in — the `?id=` branch and the `?path=` branch (the
project is the second segment of the storage path). A refusal returns 404 rather
than 403: telling a crew member that a document exists but is not theirs is
itself a disclosure.

### 1.3 The crew's Messages screen invented conversations when the Hub was down

It fell back to the fixture thread — invented messages between invented people —
whenever the Hub was unreachable. **On 29 September a key was revoked and
screens went blank for an afternoon.** Had that been the Hub rather than
BuildSuite, a crew member would have read fabricated messages from their PM and
answered them.

**Fixed:** empty, and the screen says why. A blank list is a fact; a made-up
conversation is a lie with a timestamp on it.

---

## 2 · Checked and clean

| | Finding |
|---|---|
| **Secrets in the repo** | None. No `.env` committed; the only `sb_secret_` strings are the four-character prefix used to classify a key, and documentation. |
| **Keys in the browser** | None. No `NEXT_PUBLIC_SUPABASE_*`, and a test fails the build if one appears. Both database clients are `server-only`. |
| **Cross-tenant file access** | Closed. `signedUrl` refuses any path not beginning with the caller's contractor id. |
| **The homeowner's file access** | Correct. `/api/files` sends a client through the portal's own gates — their memberships, the portal switch, and release state — rather than a tenant filter. |
| **The webhook** | Signature-verified, with the raw body, and it refuses when `GHL_WEBHOOK_SECRET` is unset. |
| **BuildSuite** | Structurally read-only: no method issues anything but `GET`, and `request()` throws on a constructed write. |
| **The portal's own data** | No fixtures left anywhere under `app/portal/`. |
| **Sign-in** | All three doors rate-limited: project code 5/hour, password 10/15 min, both keyed on email *and* IP. |

---

## 3 · Was open — three fixed the same day, one cannot be

### 3.1 No rate limit on authenticated writes — **FIXED**

Rate limiting stops at the three sign-in doors. Everything behind a session is
unmetered:

- **Uploads** — a homeowner or crew member can post 3.5 MB at a time, as often
  as they like, into storage somebody pays for. This is the one I would fix
  first: it costs money, and no legitimate user goes near a limit.
- Acknowledgements, comments, issues and messages — nuisance rather than cost.

**Fixed.** Uploads are capped at 60 an hour per person, other client writes at
120. Keyed on the person, not the project — a crew member on four jobs is one
phone and one bill. Deliberately generous: a crew member documenting a full day
uploads perhaps twenty, and a limit a real user can feel is the wrong number.

Stated plainly in the code: this is in memory, per instance, so on several
instances the effective ceiling is higher. It is a **cost ceiling, not a
security boundary**.

### 3.2 Unsigned menu links — **cannot be fixed cheaply after all**

`GHL_MENU_LINK_SECRET` is unset, so a sign-in link is accepted on the strength
of the sub-account id in the URL. The API check that the sub-account is ours is
the only thing standing between a leaked link and a session — which is now the
**agency** credential, so it says yes for all 149.

I said on 22 September that the cheap fix was to set `GHL_MENU_LINK_SECRET` and
sign the links. **That is no longer available**, and it is worth writing down
why: the menu link is now a single agency-level link carrying `{{location.id}}`
as a merge field. One URL, 149 sub-accounts — so there is nowhere to put a
per-location signature, and a signature over a merge field signs nothing.

The options are honest ones: go back to a per-sub-account menu link (149 of
them, by hand, undoing yesterday's zero-touch onboarding), or do SSO, where
GoHighLevel signs the identity for us. **SSO is the answer.** Left open
deliberately rather than papered over.

### 3.3 The homeowner's password printed in every email — **FIXED**

Their project code is their password, never expires, and appears in the body of
every update, change-order and message notification. Forwardable.

**Fixed.** The code is gone from the body of every notification. What remains
says where to find it — "on your contract and your invoices, your contractor can
resend it" — which is a pointer, not a password. `projectCode` is no longer even
destructured in that module, so nothing can quietly start printing it again, and
a test asserts its absence across all three email kinds.

This stops the bleeding. The real fix is still a tapped link instead of a typed
code.

### 3.4 `lib/data/source.ts` swapped location while keeping the default token — **FIXED**

**Fixed.** It now requires that sub-account's own token; without one it falls
through to BuildSuite and logs which sub-account is missing a credential, rather
than reading with somebody else's. `GHL_PROJECT_OBJECT_KEY` is safe to set when
you want it.

The guardrail that already forbade this pattern in the invoice, email and rail
paths now covers the data source too — it was the one caller nobody had added to
the list.

---

## 4 · Refinements worth making, not defects

- **The crew's Messages list is per-project-merged**, so a busy crew member sees
  one thread across jobs. Fine at two projects; poor at ten.
- **No read state anywhere** — a PM cannot tell whether a crew member has seen a
  message, which is the same gap acknowledgements just closed for homeowners.
- **The portal's Photos screen has no grouping** — every released photo in one
  list, no dates, no "this week". Fine at twenty photos; unusable at four
  hundred, which is one kitchen.
- **`BLOCKERS.md` lists four resolved items** as open, including two red ones
  fixed weeks ago. A list nobody trusts is worse than no list.

---

## 5 · What I could not check

- **Anything requiring a live session** — I do not sign in as a contractor, a
  crew member or a homeowner on production. The findings above are from the
  code and from read-only queries.
- **n8n, House Intelligence, Material Takeoff** — separate codebases. Sing's
  note of 29 September asks for the same inventory from each, and that is still
  outstanding.
- **Whether any file was actually fetched** through 1.2. That needs the Supabase
  storage access logs, which are worth a look now that the gap is known.
