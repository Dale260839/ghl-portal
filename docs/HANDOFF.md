# Project Hub — handoff

**For:** whoever picks this up next — a new engineer, or a future session with no
memory of how it got here.
**Written:** 2 October 2026, against `ded0aed`.
**Status:** live, in use by real contractors on real projects.

Read this first, then `CLAUDE.md` for the working rules. Everything here was
checked against the repository or a live read on the date above; where something
is unverified it says so.

---

## 1 · What it is

One project record, three permission-controlled views:

| Who | Where | Sees |
|---|---|---|
| **Contractor / office** | `/dashboard` | Everything on their own projects: costs, margin, invoices, the crew, the client's view |
| **Field crew** | `/field` | Only projects assigned to them. No money, anywhere |
| **Homeowner** | `/portal` | Only what the contractor has deliberately released |

Estimating and proposals live in **BuildSuite**. At signature a project hands off
once, and from then on the Hub is where the work is run.

**The rule the whole product rests on:** internal costs, markup, margin and
internal notes are stripped **at the data layer**, not hidden in the UI. A client
response does not contain the field set to null — it has no such property. Tests
enforce this; see §7.

## 2 · Shape of the code

```
apps/web/                 the only application (Next.js 15, React 19, Tailwind v4)
  src/app/                routes — dashboard/ field/ portal/ api/ connect/
  src/lib/                all logic. Tests sit beside the file they test
    buildsuite/           READ-ONLY client for BuildSuite's Supabase
    hub-db/               the Hub's own Supabase — the only place we write
    ghl/                  GoHighLevel: config, OAuth, invoices, email, webhook
    auth/                 sessions, sign-in doors, rate limits, invitations
    actions/ + actions.ts server actions
    data/                 the ProjectDataSource abstraction + types
packages/contracts/       shared enums and schema constants
supabase/hub/             migrations, run by hand (see §5)
docs/                     everything written down; EODs in docs/eod/
scripts/                  rehearsal, HUD, project-code checks
```

**Two databases, and they are not interchangeable.**

- **BuildSuite** (`bkngicyqgdwzmoeahqdi`) — projects, proposals, contractors,
  auth profiles. **Read-only forever.** `buildsuite/client.ts` has no method
  that issues anything but `GET` and throws if a caller constructs a write.
- **Hub** (`nexpqqxarimqmntnvzff`) — every `hub_*` table. Read and write.

They are separate clients on purpose. One shared client with a `method`
parameter would put a typo one keystroke away from writing to production data
that belongs to somebody else.

## 3 · How people get in

Three doors, one session format afterwards: a signed cookie, `bs_session_hub`,
HMAC-SHA256 over a base64url payload, 8-hour TTL, `httpOnly`, no server-side
store. Full detail in `docs/AUTHENTICATION-AUDIT.md`.

| Who | How |
|---|---|
| **Contractor** | Opens the Hub from the GoHighLevel menu link → `/auth/ghl` → `/api/auth/ghl`. No password exists for them. The sub-account is verified against the GHL API, then resolved to BuildSuite `auth_profiles` |
| **Field crew** | Email + a password they set from a per-project invitation (scrypt, signed token, 7-day TTL) |
| **Homeowner** | Email on the contract + **their project code** as the password, checked against BuildSuite live, nothing stored |

There is **one** sign-in page (`/`) for the two password-ish paths; which one it
is, is decided by the shape of what was typed (`lib/auth/unified-sign-in.ts`).

**Tenancy is two-dimensional and lives in application code, never in RLS:**
`locationId` scopes GoHighLevel reads, `auth_profile_id` → `contractor_id`
scopes Supabase reads. Every Hub method takes a scope and refuses without one.

**The identity gap, still open:** a contractor is a *sub-account*, not a person.
Everyone on their staff shares one session; nothing is attributable to an
individual. GoHighLevel SSO is the fix and it is not built.

## 4 · GoHighLevel: two Marketplace apps, and why

GoHighLevel will not issue one credential that does both jobs.

- **Sub-account app** (`ProjectHub`, client id begins `6ab2f6039bc6d1a874ed58a4`)
  holds contacts, conversations and invoices. These are **location-level scopes
  only** — greyed out on an agency app with *"this scope works with Location-level
  tokens only"*. An agency admin installs it across all sub-accounts in one
  action from Agency → App Marketplace; that grants the scopes but sends **no**
  per-location OAuth redirect, so tokens are minted on demand through
  `POST /oauth/locationToken`.
- **Agency app** holds one scope, `locations.readonly` — the single call sign-in
  makes. One install proves **every** sub-account, so a contractor who has
  installed nothing can still sign in.

Credentials resolve in one place, most specific first
(`lib/ghl/resolve-config.ts`):

> the sub-account's own install → the agency install → its Private Integration
> token (`GHL_LOCATION_TOKENS`) → the default PIT

A PIT only opens the sub-account it was made in — measured, not assumed: each of
the two tokens 401s on the other's sub-account.

**Four things GoHighLevel refuses**, all found by being told no, none documented
anywhere we could find:

1. A redirect URL containing `ghl` — refused on a white-labelled app. That is
   why the routes are `/api/connect/*`.
2. Contacts/conversations/invoices on an agency app — location-level only.
3. A **paid** app installed from an external link — and pricing cannot be edited
   once a version is published.
4. `marketplace.gohighlevel.com` asks for a HighLevel login that a contractor in
   a white-labelled agency has never had. **Never auto-redirect them there.**
   The route that works for them is the App Marketplace inside their own account.

Plan and rollback: `docs/PLAN-GHL-AGENCY-OAUTH.md`,
`docs/ROLLBACK-GHL-OAUTH.md`.

## 5 · Migrations

**Run by hand**, by the owner, in the Supabase SQL editor for the Hub project.
Code deploys on push, so the app is routinely *ahead* of the database — which is
why anything new probes for its column first (`hub-db/column-support.ts`) and
degrades rather than failing.

`0001` … `0019` in `supabase/hub/`. Every file is `if not exists`; re-running is
safe.

**State as of 2 October:**

| | |
|---|---|
| **Run** | 0001–0014, 0015, 0016, 0017, and 0018 (confirm if unsure) |
| **NOT run** | **`0019_photo_update_link.sql`** — photographs cannot belong to the update they were sent with until it is |

Never "fix" a `42501` by granting `anon`. That is how the 29 September outage
was caused in the first place, from the other direction.

## 6 · Environment

Secrets are server environment variables in Vercel. No key may reach the
browser; there is no `NEXT_PUBLIC_SUPABASE_*` and a test fails the build if one
appears.

| Variable | Notes |
|---|---|
| `SUPABASE_URL`, **`SUPABASE_SERVICE_KEY`** | BuildSuite. **Must be the service key** — `anon` was revoked 29 Sep and every table 401s. `SUPABASE_ANON_KEY` is read as a fallback and logs loudly |
| `HUB_SUPABASE_URL`, `HUB_SUPABASE_KEY` | The Hub. Must be the **secret** key; migration 0010 revoked `anon` |
| `SESSION_SECRET` | ≥32 chars. Rotating it signs everyone out |
| `GHL_API_BASE_URL`, `GHL_API_VERSION`, `GHL_PRIVATE_INTEGRATION_TOKEN` | The minimum to reach GoHighLevel |
| `GHL_LOCATION_TOKENS` | `locationId:token`, comma-separated. The fallback path, being retired |
| `GHL_OAUTH_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` / `GHL_OAUTH_ENABLED` | Sub-account app |
| `GHL_AGENCY_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` / `GHL_AGENCY_ENABLED` | Agency (sign-in) app. Deliberately a **separate** switch |
| `GHL_AUTO_CONNECT` | Off. Redirecting contractors to the marketplace login is a dead end |
| **`ADMIN_LOCATION_IDS`** | Who gets "Switch account" / "Viewing as". **Empty means nobody.** Not set yet |
| `GHL_SEND_EMAIL` | Email actually sends only when `true` |
| `GHL_WEBHOOK_SECRET` | Unset — so no real webhook has ever been received |
| `GHL_PROJECT_OBJECT_KEY` | Unset. Safe to set since 30 Sep; it was not before |
| `GHL_MENU_LINK_SECRET` | Unset, so unsigned menu links are accepted (§9) |
| `ENABLE_DEMO_SIGNIN`, `ENABLE_ACCOUNT_SWITCH`, `DISABLE_VIEW_AS` | Demo and operator flags. `DISABLE_VIEW_AS` is off by **default** |

## 7 · Testing, and the practice that matters

```
cd apps/web && npm test          # 1,219 tests, node --test, no framework
npx tsc --noEmit                 # must be clean
npm run build                    # must be clean
```

**Guardrails** (`src/lib/guardrails.test.ts`, 60 of them) scan the source for
rules a type cannot express: no screen prints a raw project id, a homeowner never
sees the award code, no form submits through a button that stays live, every
Hub-reading screen handles an account with no contractor, the operator controls
are gated on identity, no `app/field` or `app/portal` screen may import fixtures.

**Break-test everything.** The practice here is: after writing a test,
reintroduce the bug it is meant to catch and confirm it fails. It is in the EODs
because it keeps working — roughly a quarter of break-tests have *missed* on the
first attempt, every time because the test asserted on the answer rather than on
the mechanism. Two recent examples worth internalising:

- a guardrail asserted `fieldMaySee` *appeared* in the file, which passes
  happily while the condition beside it says `false`. Pin a call to the refusal
  that uses it.
- a fake store ignored the `clientId` it was handed, so a test could not see the
  difference between reading the right app's row and the wrong one.

## 8 · Deployment

- `main` is deployed. **Pushing to `company` deploys to production.**
- Two remotes: `company` → `home-afk/project-hub` (Vercel watches this),
  `origin` → `Dale260839/ghl-portal`. Keep them level.
- Environment variables bind **at deploy time**. Changing one does nothing until
  a redeploy.
- Live at `https://project-hub-one-vert.vercel.app`.
- `pre-ghl-oauth` is a tag on both remotes marking the state before the
  Marketplace work, as a revert target.

**Every commit must be authored by `home-afk`, or the deployment is blocked.**
Vercel is on the Hobby plan, which refuses to build a commit whose author is not
the account's own GitHub user: *"the deployment was blocked because the commit
author did not have contributing access"*. The local git identity here is
already `home-afk <272685640+home-afk@users.noreply.github.com>` — leave it
alone.

**So never merge a pull request with GitHub's green button on this repo.**
GitHub authors that merge commit as whoever clicked it, and on 5 October that
blocked production: thirteen commits authored by `home-afk` arrived through
PR #2, and the one commit GitHub added on top — authored by `dale132414` — was
refused. Merge locally and push instead.

If a commit is already pushed with the wrong author, `git commit --amend
--author=…` with `GIT_COMMITTER_NAME`/`EMAIL` set, then force-push with a lease.
Be aware that **a force-push does not reliably trigger a new Vercel build** — the
hash changes but the hook may not fire, so the dashboard keeps showing the
blocked deployment. Push an ordinary commit afterwards to wake it up.

**Another session edits this same working tree.** Fetch before you push, merge
rather than force, and never `git stash -u` across the repo: it once swept away
a colleague's uncommitted work.

## 9 · What is broken, open, or waiting

**Needs the owner (Dale):**
- Run `0019_photo_update_link.sql`.
- Set `ADMIN_LOCATION_IDS`, or nobody gets the operator controls.
- Delete the Private Integration tokens once contractors are proven on the
  Marketplace path — a separate, deliberate day.
- Reply to Sing's 29 Sep note for n8n, House Intelligence and Material Takeoff.

**Needs Chris (product decisions):**
- The signed-contract link is **public** — anyone holding the URL can open it.
- A payment gateway in GoHighLevel. Invoices can be created and sent; nothing
  can be *paid*.
- `Delayed` as a fifth milestone status, if wanted.

**Needs GoHighLevel admin:** the webhook secret. Until then no real webhook has
ever arrived and every event name in `webhook-routing.ts` is inferred.

**Known and unfixed:**
- **Unsigned menu links are accepted.** The cheap fix — signing them — is *not*
  available: the menu link is one agency-level URL carrying `{{location.id}}`,
  so there is nowhere to put a per-location signature. SSO is the answer.
- **The homeowner's project code is their password**, never expires, printed on
  their documents. It is out of our emails as of 30 Sep. The real fix is a
  tapped link.
- **A contractor is a sub-account, not a person** (§3).
- `docs/BLOCKERS.md` lists four resolved items as open and needs a pass.

**Refinements, not defects:** crew Messages merged across jobs; no read state on
messages; portal Photos ungrouped (unusable at four hundred photos, which is one
kitchen); the warranty half of Completion is not built, deliberately — there is
no warranty data and inventing some would be worse.

## 10 · Traps that have cost real time

- **Supabase is production.** Never alter a table. Migrations are proposed and
  the owner runs them.
- **No Docker, no WSL** on this machine. Use native tooling.
- **A BuildSuite read that returns nothing, or 401s, is a KEY problem**, not a
  data problem. Check `SUPABASE_SERVICE_KEY` before anything else.
- **Never invent a fallback that writes**, and never show fixture data where a
  real read failed. On 29 Sep a key was revoked for an afternoon; a screen that
  falls back to sample data would have shown a crew member invented messages
  from their PM.
- **`as` casts hide real failures.** The read path casts milestone status back
  to a union; that is how an invalid value type-checked its way onto a screen.
- **Bash heredocs mangle long content** in this environment. Write files with
  the editor tool or a Python script.
- **Vercel env changes need a redeploy.** Half an hour has been lost to this
  more than once.

## 11 · Where to read next

| | |
|---|---|
| `CLAUDE.md` | The working rules. Read before writing code |
| `docs/ARCHITECTURE.md` | The §-numbered spec everything references |
| `docs/AUTHENTICATION-AUDIT.md` | Every door, every gate, and ten known gaps |
| `docs/SECURITY-AUDIT-2026-09-30.md` | The most recent sweep: what was found, fixed, and left |
| `docs/ROLE-REHEARSAL-CHECKLIST.md` | How to exercise all three roles on production |
| `docs/ROLLBACK-GHL-OAUTH.md` | How to undo the Marketplace work, four levels deep |
| `docs/BLOCKERS.md` | The standing list — stale, see §9 |
| `docs/eod/` | What happened each day, and why. The real history |

**The EODs are the most useful thing in here.** They record what was decided and
what it cost, including the mistakes — a plan that was wrong by lunchtime, a bug
shipped and found the next morning, four separate refusals from GoHighLevel. The
code says what; those say why.
