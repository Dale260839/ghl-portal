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

## 3 · Open, with a recommendation

### 3.1 No rate limit on authenticated writes — **the real API-abuse surface**

Rate limiting stops at the three sign-in doors. Everything behind a session is
unmetered:

- **Uploads** — a homeowner or crew member can post 3.5 MB at a time, as often
  as they like, into storage somebody pays for. This is the one I would fix
  first: it costs money, and no legitimate user goes near a limit.
- Acknowledgements, comments, issues and messages — nuisance rather than cost.

Not urgent in the sense of a hole, since every one needs a real account on a
real project. Urgent in the sense that storage bills arrive monthly.

### 3.2 Unsigned menu links are still accepted in production

`GHL_MENU_LINK_SECRET` is unset, so a sign-in link is accepted on the strength
of the sub-account id in the URL. The API check that the sub-account is ours is
the only thing standing between a leaked link and a session — which is now the
**agency** credential, so it says yes for all 149.

Known since the audit on 22 September and unchanged. The proper fix is SSO; the
cheap one is setting that secret and signing the links.

### 3.3 The homeowner's password is printed in every email we send them

Their project code is their password, never expires, and appears in the body of
every update, change-order and message notification. Forwardable.

Recommended before, and it remains the single highest-value change on the client
side: a tapped link instead of a typed code.

### 3.4 `lib/data/source.ts` swaps location while keeping the default token

Dormant, because `GHL_PROJECT_OBJECT_KEY` is unset. It would read one
contractor's sub-account with another's credential the day that key is set.
**Do not set it until this is fixed.**

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
