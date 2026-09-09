# Homeowner login: the project code is the password

**Decision:** Chris, 2026-09-10.
**Status:** built and merged on the Hub side. **One thing is needed from BuildSuite** — §3.
**Supersedes:** the emailed sign-in link (C-2 / D3 §6), retired the same day.

---

## 1 · The flow, end to end

```
  contractor + homeowner sign in BuildSuite
              │
              ▼
  BuildSuite automation emails the homeowner their project code    ← §3, NOT BUILT
              │
              ▼
  homeowner opens  /signin
    email  = the address on the contract   (projects.client_email)
    password = the project code            (projects.project_code)
              │
              ▼
  the Hub verifies BOTH against BuildSuite, live, and requires a SIGNED proposal
              │
              ▼
  a hub_memberships row opens itself — role 'client', scoped to that project
              │
              ▼
  /portal
```

Nobody invites the homeowner. Nothing expires between the signature and their
first visit. If they lose the email, the contractor reads them the code.

**Invitations still exist, for field crew only.** `INVITABLE_ROLES` is
`['field']` and `invite()` validates against it, so a contractor cannot create a
homeowner account by hand at all.

---

## 2 · What the Hub checks, in order

Every one of these is tested, and each was verified by reintroducing the bug it
prevents and watching the test go red.

| # | Check | Where |
|---|---|---|
| 1 | Attempt limit — **5 per hour**, keyed on the email and the caller's IP, never on the code | `lib/auth/rate-limit.ts` → `CLIENT_CODE_LIMIT` |
| 2 | Code and address are *validated*, not escaped; a malformed one never reaches the query | `lib/buildsuite/projects.ts` → `clientLoginPair` |
| 3 | Code **and** email matched together inside BuildSuite, and `client_email` is never selected back out | `findSignedProjectForClient` |
| 4 | Exactly one project, or nothing — two projects sharing a code signs nobody in | same |
| 5 | **A SIGNED proposal is required**: `signature_status = 'SIGNED'` **and** `signature_signed_at` set **and** not deleted | same |
| 6 | A contractor must be resolvable, or nobody gets in | same |
| 7 | A revoked membership refuses, even with a correct code | `hub-db/team.ts` → `provisionClientFromSignedProject` |

The session that results carries **no `contactId` and no `authProfileIds`**.
That is the privacy model, not an omission: a contact id would return every
project that contact holds, and a profile would open BuildSuite to them. Their
access is the membership's `project_ids` plus the §9.1 gate, re-read on every
request so revocation is immediate.

### One person, several projects

§1.4, and eleven client addresses in BuildSuite already hold more than one job.
`hub_memberships` is unique on `(contractor_id, lower(email))` where not
revoked, so there is one row per person per contractor and `project_ids` is a
**union** — each code proves one project and adds it.

Two consequences worth knowing before they surprise someone:

- A homeowner with two jobs has **two codes**, either of which signs them in.
  After using both, they see both projects.
- Unticking a project on the Team screen **does not stick** for these accounts —
  the next sign-in with that code re-adds it, because the signed contract still
  says it is theirs. **Revoke is the control that removes a homeowner**, and it
  is checked before anything is written.

---

## 3 · What BuildSuite needs to send  ← the only outstanding piece

When a proposal reaches `signature_status = 'SIGNED'`, email
`projects.client_email` with `projects.project_code`.

Nothing else is required — no callback, no webhook, no shared secret, no new
endpoint. The Hub verifies against BuildSuite at sign-in, so it needs no
notification that a signature happened; it only needs the homeowner to know
their code.

The message needs three things:

1. the project code, shown as the code and not folded into a sentence;
2. the address it must be used with (`client_email`, the one being written to);
3. the link — `https://<hub host>/signin`.

**Do not put the signed-contract PDF link in it.** Sing, 2026-09-09: that URL is
public and unauthenticated. A guardrail already refuses it on any client-facing
surface in this repo (`§9.1 the public signed-contract URL never reaches a
client surface`), and the same reasoning applies to a BuildSuite email.

---

## 4 · Live data, measured 2026-09-10

| | |
|---|---|
| Projects (not deleted) | 103 |
| With a `project_code` | 52 |
| With both a code and a `client_email` | 51 |
| **With a code but NO `client_email`** | **1 — `BSA-028`** |
| Signed proposals | 6, across 3 projects |
| Signed projects ready to sign in today | 2 |

Code shapes are `BSA-NNN` (from the feed) and `BSA-APS-NNN` (contractor
created); both are accepted, no duplicates, numbers run 1–52.

**`BSA-028` can never sign in** — there is no address to match against. That is
a BuildSuite data gap, not a Hub bug, and it fails closed.

### `proposals.contractor_id` is not reliable

Null on **13 of 48** proposals, including **one of the six signed ones**
(`BSA-APS-001`). Without a fallback that homeowner is refused despite a signed
contract and a correct code — found by running the real reader against live
data, not by reading the schema.

The Hub falls back through `ContractorResolver`, which is the one place that
knows how a BuildSuite profile maps to a contractor (dedicated ID fields only;
ambiguity resolves to nothing, never to a coin flip — §3.6, D4 §6). It resolves
`BSA-APS-001` via the GHL contact id.

**Worth fixing at source anyway**: set `contractor_id` on the proposal, or
`contractor_id` on the owning `auth_profiles` row. The fallback costs an extra
read and covers a gap that should not exist.

---

## 5 · The security position, stated plainly

Project codes are **sequential and about six bits** — `BSA-001` to `BSA-052`.
Before this change the code was a *lookup* that minted only an email, and the
comment in `lib/auth/client-lookup.ts` said so:

> The code space is small … That is acceptable ONLY because this mints nothing …
> **If this ever issues a session directly, the code is not enough.**

That concern was raised before building and the decision stands. What the Hub
does instead is make the weak factor as expensive as it can be made:

- **the signature gate** (§2.5) — an unsigned project's code opens nothing, at
  any rate, forever;
- **5 attempts an hour** per email and per IP, so an attacker who already knows
  a homeowner's address needs roughly ten hours of uninterrupted guessing;
- **no stored hash** — the code is checked live, so `hub_memberships` holds no
  client credential to crack, and a contract that stops being signed stops
  opening a portal.

**Residual risk:** someone who knows a homeowner's email address and will guess
for hours can find a six-bit sequential code.

**The real fix is on the BuildSuite side** and is not urgent, but should not be
forgotten: give the code more entropy, or issue a separate access code that is
not the human-readable project reference. Either would make this door as strong
as the rest of the system without changing anything here — the Hub compares
whatever string BuildSuite puts in `project_code`.

---

## 6 · What changed in this repo

| File | |
|---|---|
| `lib/auth/client-credentials.ts` | **new** — the whole policy, testable with no database |
| `lib/auth/rate-limit.ts` | `CLIENT_CODE_LIMIT`, `clientCodeKeys` |
| `lib/buildsuite/projects.ts` | `findSignedProjectForClient`, the shared validator, the contractor fallback |
| `lib/hub-db/team.ts` | `provisionClientFromSignedProject`; `INVITABLE_ROLES` → `['field']` |
| `lib/actions.ts` | `signInWithCode` |
| `app/signin/` | the form is now credentials, not a link request |
| `app/auth/verify/route.ts` | **retired** — refuses and redirects |
| `app/dashboard/team/page.tsx` | field-crew invites only; homeowners shown as *signed in with their project code* |
| `lib/ghl/email.ts` | invitation copy narrowed to field crew |

`lib/auth/client-lookup.ts`, `sign-in-request.ts` and `verification-token.ts`
are **kept and still tested**, but nothing reaches them from a screen — which is
what closes that door, since a server action no component imports has no
callable id. They are the obvious answer if the code's six bits are ever judged
insufficient.

**No database migration.** `hub_memberships` already had every column this
needs.
