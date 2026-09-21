# Project Hub — how authentication works today

**For:** Sing, so the Hub can be patterned to BuildSuite's own authentication.
**Written:** 2026-09-22, from the code on `main` (commit `e47ea8f`).
**Live at:** https://project-hub-one-vert.vercel.app (Next.js on Vercel).

This is a description of what exists, not a proposal. Every claim below points
at the file that implements it. The last two sections are the honest gaps and
the questions we need answered to line up with BuildSuite.

---

## 1 · The short version

Three kinds of people reach the Hub, and they authenticate in three different
ways. There is **one shared session format** afterwards — a signed cookie, no
server-side session store.

| Who | How they prove who they are | Credential held where |
|---|---|---|
| **Contractor / office** | Opens the Hub from the BuildSuite (GoHighLevel) menu link. No password exists for them. | GoHighLevel — we verify the sub-account against the GHL API with our own credential |
| **Field crew** | Email + a password they set from a per-project invitation link | Hub database (`hub_memberships.password_hash`, scrypt) |
| **Homeowner** | Email on the contract + **their project code** as the password | Nothing stored — the code is checked against BuildSuite live, every time |

There is one sign-in page (`/`) for the two password-ish paths. Which of the two
it is, is decided by the *shape* of what was typed, not by the person choosing a
role (`lib/auth/unified-sign-in.ts`).

---

## 2 · Contractor — GoHighLevel menu link

**Route:** `/auth/ghl?locationId=…` → `/api/auth/ghl` (`app/api/auth/ghl/route.ts`)

1. The menu link carries `locationId` (optionally `userId`, `email`,
   `timestamp`, `signature`).
2. **`verifyLanding`** (`lib/auth/ghl-landing.ts`) checks the parameters. If
   `GHL_MENU_LINK_SECRET` is set, the link must carry a valid HMAC-SHA256
   signature over `locationId|userId|email|timestamp`, and be at most 5 minutes
   old. **In production an unsigned link is accepted** — verified on 2026-09-17
   and again on 09-18 by opening `/api/auth/ghl?locationId=…` with no signature
   and getting a session — so `GHL_MENU_LINK_SECRET` is unset there and this
   step currently only requires a `locationId` to be present.
3. **`verifyGhlLocation`** (`lib/auth/ghl-verify.ts`) is the real gate: we call
   `GET /locations/{id}` against GoHighLevel with **our own** Private
   Integration token. A location we cannot fetch gets no session. This is what
   stops someone pasting another agency's location id into the URL.
4. The location is resolved to BuildSuite `auth_profiles` for that location. No
   profiles, no session.
5. A session cookie is written with `role: 'contractor'`, the auth profile ids,
   and the location id.

**What this means:** the contractor's identity is *the sub-account*, not a
person. Everyone who can open that menu link in GoHighLevel gets the same
session — the Hub cannot tell two staff members of one contractor apart, and
nothing is attributable to a named individual. `session.name` is the email from
the link when GoHighLevel sends one, otherwise the literal `'GoHighLevel user'`.

---

## 3 · Field crew — invitation, then a password

**Invitation** (`lib/hub-db/team.ts`): a contractor invites someone **to a
project** from that project's People screen. Invitations are for field crew
only; a homeowner address is refused.

- The token is an HMAC-signed payload (`lib/auth/session-crypto.ts`) carrying a
  purpose, the email, the role and a `jti`, **and** its SHA-256 hash is stored
  in `hub_invitations`. A database dump alone cannot redeem one.
- TTL 7 days (`INVITE_TTL_SECONDS`). Single use: redemption is refused if
  `accepted_at` or `revoked_at` is set, or it has expired.
- Redeeming sets a password: **minimum 10 characters**, hashed with
  **scrypt** (N=16384, 64-byte key, 16-byte salt), stored as
  `scrypt$N$salt$hash` so the cost can be raised later.
- Password reset is the same mechanism with a 24-hour TTL; older unused links
  are revoked first, and the old password keeps working until a new one is set.

**Sign-in:** email + password at `/`. An unknown email costs the same as a wrong
password — a dummy scrypt hash is verified so the timing does not differ.
Revoked or not-yet-activated accounts are told so **only after** the password
was correct.

---

## 4 · Homeowner — the project code is the password

**Decided by Chris, 2026-09-10.** Full write-up in
`docs/CLIENT-LOGIN-PROJECT-CODE.md`; the policy is
`lib/auth/client-credentials.ts`.

- Username: the `client_email` on the BuildSuite project. Password: that
  project's `project_code` (e.g. `BSA-053`).
- **The signature gate:** the project must have a proposal with
  `signature_status = 'SIGNED'` **and** `signature_signed_at` set. An unsigned
  project admits nobody, whatever code is typed.
- Both halves are matched **inside the database query**, and `client_email` is
  never selected back out.
- On success a Hub membership is provisioned automatically (role `client`,
  scoped to that project). No invitation, no password, nothing to expire
  between signature and first visit.
- The session deliberately carries **no GoHighLevel contact id**: with one, the
  portal would resolve every project that contact holds, including ones whose
  code the visitor has never proved.

**The weak factor, stated plainly:** project codes are sequential (`BSA-001`,
`BSA-002`, …) — roughly six bits. What makes that survivable is the signature
gate plus the attempt limit below, not the secret itself.

---

## 5 · The session

`lib/session.ts`, `lib/auth/session-crypto.ts`.

- Cookie `bs_session_hub`, `httpOnly`, `sameSite=lax`, `secure` in production,
  `path=/`.
- Format `v1.<base64url(JSON)>.<base64url(HMAC-SHA256)>`; signed with
  `SESSION_SECRET` (refused if under 32 characters). Signature is verified
  **before** the payload is parsed.
- Claims: `role`, `name`, `email`, optional `authProfileIds`, `ghlLocationId`,
  `membershipId`, `contactId`, `returnTo` (the dev "view as" scaffolding).
- **TTL 8 hours**, carried in the token (`exp`) and in the cookie `maxAge`.
- **Stateless.** There is no session table and no server-side revocation list.
  Signing out clears the cookie; it does not invalidate anything.

**How revocation still works for invited users** (`lib/access.ts`): any session
carrying a `membershipId` is re-checked against `hub_memberships` on **every
request** — the role, the grants and the project list all come from the database
rather than the cookie, and a revoked membership fails closed (so does a Hub
outage). Contractor sessions carry no membership id, so nothing re-checks them
inside their 8 hours; the only lever is rotating `SESSION_SECRET`, which signs
everyone out at once.

---

## 6 · Tenancy — what a session is allowed to read

Authentication answers *who*; this answers *whose data*.

- A contractor session carries `authProfileIds` (BuildSuite `auth_profiles.id`)
  and a `ghlLocationId`. `tenantScopeFor` (`lib/tenant-scope.ts`) resolves those
  to a **contractor id**, which is the key every Hub table is filed under.
- An invited crew member inherits the contractor's auth profiles from their
  membership row, so they resolve to the same contractor — and are then narrowed
  to their assigned projects.
- A homeowner carries **no tenant keys at all**. Their scope is derived from the
  project they proved, via `hubScopeOfProject`.
- Every Hub read and write asserts a contractor id (`assertContractor`); an
  unscoped read throws rather than returning anything.

---

## 7 · Rate limiting and attempt cost

`lib/auth/rate-limit.ts`. Counted per **email** and per **IP**, whichever is
stricter.

| Door | Limit |
|---|---|
| Homeowner project code | 5 per hour |
| Field crew password | 10 per 15 minutes |
| Retired emailed sign-in link | 5 per 15 min (request), 20 per 15 min (verify) |

**Caveat:** the counters are in-memory, so they are per serverless instance and
reset on restart. The module says so and names the fix (a `hub_*` table behind
the same interface). This is the single weakest part of the current design.

---

## 8 · Authorisation, after sign-in

- A role × action × resource matrix (`lib/permissions.ts`) — e.g. only a
  contractor may `create` a task; a crew member may `update` one.
- Per-user grants stored in `hub_grants` can **narrow** an invited user further,
  never widen them.
- Client-facing reads go through gates (`lib/portal-gates.ts`): the portal master
  switch, the per-section switch, and the row's own `client_visible`.
- Ownership is separate from permission: a crew member may only act on a task
  whose `assigned_to` is their membership id.

---

## 9 · Development scaffolding (off in production)

| Flag | Effect |
|---|---|
| `ENABLE_DEMO_SIGNIN` | Demo identities can sign in with any password. Real BuildSuite profiles — must never be set on a deployment. |
| `ENABLE_ACCOUNT_SWITCH` | Switch between contractors without signing in again. |
| `DISABLE_VIEW_AS` | "View as" field/client. Defaults ON; the assumed session inherits the contractor's own tenant keys, never the demo account's. |
| `GHL_ALLOW_UNVERIFIED_LANDING` | Accept a menu link without verifying the location. Non-production only. |

---

## 10 · Gaps we already know about

1. **The contractor is a sub-account, not a person.** No named individual, no
   per-user permissions on the office side, nothing attributable in an approval
   trail. This is the biggest one and the reason for this document.
2. **The menu link is unsigned in production.** `GHL_MENU_LINK_SECRET` is unset,
   so the link's own parameters are unauthenticated; the GHL location lookup is
   carrying the whole gate.
3. **Rate limits are per instance and in memory.**
4. **No MFA anywhere**, for any role.
5. **Sessions cannot be revoked individually** — 8 hours, or rotate the secret
   for everybody.
6. **The homeowner's password is their project code**, which is sequential and
   cannot be changed or reset by them (it is BuildSuite's field, and it is also
   the project's identity).
7. **No audit log of authentication events.** Sign-ins are not recorded beyond
   `last_seen_at`.
8. **Two user stores.** BuildSuite has its own users; the Hub has
   `hub_memberships`. The same human can exist twice, and nothing reconciles
   them.

---

## 11 · What we would like from BuildSuite

The goal: a contractor's **staff** sign in as themselves, once, and both systems
agree who they are. Three shapes, roughly in order of how much we like them:

**A. BuildSuite issues a signed hand-off (our preference).**
BuildSuite already knows the user. Send them to the Hub with a short-lived
signed token — HMAC or JWT, five-minute expiry, single use — carrying: the
BuildSuite user id, their email and display name, the `auth_profile_id`(s) and
`contractor_id` they may act for, the GHL `location_id`, and a role. We verify
the signature, mint our own session and stop maintaining a second password store
for office staff. This is the same shape as our existing menu-link verification,
so it is a small change on our side. We would need: the signing algorithm, key
exchange and rotation, and the exact claim names.

**B. We accept BuildSuite's Supabase Auth JWT.**
If BuildSuite staff already hold a Supabase session, we can verify that JWT with
the project's JWKS and map `sub` → `auth_profiles`. Cleanest identity-wise, but
it requires the two apps to share a domain or an explicit token hand-off, and we
would need the mapping from a Supabase user to `auth_profiles` / `contractors`.

**C. We keep our own passwords for office staff too.**
Works without BuildSuite doing anything — and leaves two user stores, two
password resets, and no single answer to "who approved this".

**Questions for you, Sing:**
1. How does a BuildSuite user authenticate today — Supabase Auth, or something
   of your own? Is there already a session token we could verify?
2. Is there a user-level identity behind `auth_profiles`, or is a profile the
   smallest unit? Which column links a person to a `contractor_id`?
3. Would you be willing to sign a hand-off (option A)? If so, what would you
   want in the claims, and how should the key be exchanged and rotated?
4. Does BuildSuite have anything for the **homeowner** side, or is the project
   code the intended long-term answer there too?
5. Is there an existing audit or event log we should write authentication events
   into, rather than inventing our own?

---

## 12 · Where to look in the code

| Concern | File |
|---|---|
| One sign-in decision (crew vs homeowner) | `apps/web/src/lib/auth/unified-sign-in.ts` |
| Sign-in action and session minting | `apps/web/src/lib/actions.ts` (`signIn`) |
| GoHighLevel landing | `apps/web/src/app/api/auth/ghl/route.ts`, `lib/auth/ghl-landing.ts`, `lib/auth/ghl-verify.ts` |
| Homeowner project-code policy | `apps/web/src/lib/auth/client-credentials.ts` |
| Session cookie and token | `apps/web/src/lib/session.ts`, `lib/auth/session-crypto.ts` |
| Passwords, invitations, resets | `apps/web/src/lib/hub-db/team.ts` |
| Live re-check and revocation | `apps/web/src/lib/access.ts` |
| Tenancy resolution | `apps/web/src/lib/tenant-scope.ts`, `lib/tenancy.ts` |
| Attempt limits | `apps/web/src/lib/auth/rate-limit.ts` |
| Role matrix and grants | `apps/web/src/lib/permissions.ts` |
