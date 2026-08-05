# BuildSuite → GHL — what's actually implemented

**Repo:** `ProgrammingProjects/ghl-portal/` · `github.com/Dale260839/ghl-portal`
**As of:** 2026-08-04 · **Tests:** 67 green · **Build:** clean

Companion to [the kickoff entry](buildsuite-ghl-kickoff.md), which covers *why*
the project is shaped this way. This one covers *what exists*, where, and which
parts are load-bearing.

---

## At a glance

```
apps/web/                     Next.js 15 App Router — all three experiences
  src/app/                    routes
  src/lib/client-projection   the gate + allow-list projection (pure, tested)
  src/lib/client-view         server-only re-export of the above
  src/lib/data/               ProjectDataSource seam — fixtures | GHL
  src/lib/ghl/                API client, errors, config, response mapper
  src/lib/session, actions    demo auth + server actions
packages/contracts/           verbatim rules from ARCHITECTURE.md, as code
```

Two npm workspaces. Node ≥22.6 strips TypeScript natively, so `packages/contracts`
ships raw `.ts` with no build step; the web app pulls it via `transpilePackages`.

---

## The three surfaces

| Route | Role | Screens |
|---|---|---|
| `/` | — | Sign-in, three identities |
| `/dashboard` | contractor | Portfolio Overview (KPIs, attention list, review queue, client-waiting) |
| `/dashboard/projects` | contractor | Projects List — table on desktop, cards on mobile |
| `/dashboard/projects/[id]` | contractor | Project Overview — timeline, financials, visibility switches, updates |
| `/dashboard/updates` | contractor | Field Update Review — the seven verbatim actions |
| `/field` | field | Mobile-first: today's tasks, daily update form |
| `/portal` | client | Project switcher, progress, schedule, budget, published updates |

Roles are checked in each `layout.tsx` server-side and redirect, so a wrong role
never renders the page rather than rendering it hidden.

`/portal?preview=<projectId>` lets a contractor view the client portal **through
the same gate** — it resolves the requesting contact from the project rather than
bypassing the check, so the preview proves the rule instead of skipping it.

---

## The security implementation — the load-bearing part

Three layers, in order:

**1. The gate** (`packages/contracts/src/gate.ts`). Four clauses: client-visible,
approval published, portal enabled, and the requesting contact is associated with
the record's project. Returns the *first failing clause* rather than a boolean, so
denials are debuggable in logs without logging the record.

**2. An allow-list projection** (`apps/web/src/lib/client-projection.ts`). The
client DTO is constructed field by field. This is the single most important
choice in the codebase:

> Deny-lists fail open. Allow-lists fail closed.
>
> A deny-list means a new internal field on `Project` reaches the client until
> someone remembers to add it to the list. An allow-list means it never reaches
> the client until someone deliberately adds it. Same amount of code, opposite
> failure mode.

**3. `assertNoInternalFields`** as a backstop, which throws if a §9.3 field made
it into the payload anyway.

Plus one structural guard: `client-view.ts` imports `server-only`. Pull it into a
client component and the **build fails** — the enforcement can't accidentally
migrate to the browser.

### Two rules that are easy to get wrong

- **`Approved Internally` is not approved for the client.** Four approval values,
  two containing the word "Approved". Only `Approved & Published` reaches a
  client. Encoded as `PUBLISHED_APPROVAL_STATUS` so nobody writes the literal.
- **An unparseable checkbox is `false`.** `Client Portal Enabled` is a clause of
  the gate, so a value the mapper can't read must *close* the gate. Coercing
  loosely toward `true` would expose a project the contractor never enabled.

---

## The data seam

`ProjectDataSource` (`src/lib/data/source.ts`) is an interface with two
implementations: `FixtureDataSource` and `GhlDataSource`. `getDataSource()` picks
GHL when **every** required env var is present, fixtures otherwise.

All-or-nothing on purpose. A half-configured environment falls back to fixtures
with a warning rather than half-working — three real projects and two invented
ones is worse than an obvious demo. Every screen shows a banner while on
fixtures, so nobody demos sample data believing it's live.

**Building the seam before the credentials existed is why the demo shipped in
week 1.** The screens were written against the interface; swapping the
implementation touches no page.

---

## The GHL client

`src/lib/ghl/` — deliberately layered so an incorrect guess stays cheap:

| File | Knows about |
|---|---|
| `client.ts` | HTTP, auth headers, retries, timeouts. **Nothing about projects.** |
| `errors.ts` | Typed failures, each tagged retryable or not |
| `config.ts` | Env vars; reports *which* are missing rather than throwing |
| `mapper.ts` | **Response shapes — the only file that is guessing** |

Retry policy, and the reasoning:

- **429** honours `Retry-After` when sent, otherwise backs off.
- **5xx and network failures** retry with exponential backoff.
- **401 and 400 never retry.** A bad token stays bad; a malformed request stays
  malformed. Retrying either just burns rate limit.
- **Backoff is jittered.** The hourly sync-back fires every project on the same
  schedule — without jitter, a rate limit would make every request retry in
  lockstep and hit the limit again together.

---

## Test coverage

67 tests, no test framework — `node --test` with native type stripping.

**`packages/contracts` (34)** — the architecture's invariants as executable
rules. The notable one does a breadth-first search over every legal move a field
user can make and proves they can only ever reach `DRAFT` and `PENDING`. "Field
updates are never auto-published" stops being a rule someone remembers and
becomes one that fails a build.

**`apps/web` (33)** — 14 gate/leak tests plus 19 transport and mapper tests.

The leak tests were originally manual curls against the running app. That proves
it was safe the afternoon it was run; the tests prove it stays safe. They check
**values, not just keys** — a field rename would slip past a key-only check:

```
original estimate, markup, margin, internal notes, delay reason → 0 occurrences
unpublished / internally-approved updates                       → not served
a contact requesting someone else's project                     → denied
switches off → budget, team, completion date                    → withheld
```

---

## What is NOT real yet

Worth knowing before demoing or building on it:

| Thing | State |
|---|---|
| Data | Fixtures. Banner on every screen. |
| Auth | Demo cookie, not GHL portal login. Shaped like the real thing so the swap touches one file. |
| Publish state | In memory — resets on server restart. |
| `mapper.ts` + endpoint paths | **Provisional.** Never run against a real sub-account. |
| Milestones / Tasks / Daily Updates over GHL | Return empty — each needs its own object key. Screens render empty states rather than fabricating rows. |
| WF1–WF8 | Not built. Fully specified, buildable without credentials. |
| Client Visibility Settings | The one Phase-3 screen not built. |

---

## Running it

```bash
npm install
npm run dev              # http://localhost:3000
npm test                 # contracts
npm test --workspace @buildsuite/web
```

Sign in — no password, it's a demo build:

| Email | Experience |
|---|---|
| `marcus@allianceproservices.com` | Contractor Dashboard |
| `tony@allianceproservices.com` | Field Interface |
| `dana@example.com` | Client Portal (two projects) |

**The loop worth demoing:** submit an update as Tony → it lands `Pending` in
Marcus's queue with internal notes flagged and the client summary editable →
Approve and Publish → sign in as Dana and it's there, edited summary only. The
internal notes aren't hidden by the template; they were never read.

---

## The transferable lessons

1. **Build the seam before the dependency.** The interface existed before the
   credentials, which is why a demo shipped while still waiting on keys.
2. **Quarantine the guesses.** One file assumes response shapes; everything else
   is shape-agnostic. Being wrong costs one file, not a rewrite.
3. **Allow-lists over deny-lists** anywhere a leak is the failure mode.
4. **Fail closed on unparseable security-relevant input.** Loose coercion toward
   `true` on a gate clause is a data breach with good intentions.
5. **Convert manual verification into tests.** Hand-checking proves the system
   was safe the afternoon someone checked. A test proves it stays safe.
