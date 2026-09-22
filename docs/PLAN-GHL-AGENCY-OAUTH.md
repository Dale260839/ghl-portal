# Plan — remove the per-contractor PIT keys

**Goal:** a contractor's sub-account works the moment it exists in the agency.
No Private Integration token to request, paste, or rotate. Ever.

**Status:** **built and switched off**, 2026-09-22. Steps 1–7 below are written
and tested (1,146 tests green, build clean); steps 8–9 need the Marketplace app
to exist. Nothing changes for anyone until `GHL_OAUTH_ENABLED=true`.
**Rollback:** `docs/ROLLBACK-GHL-OAUTH.md`. The state before this work is tagged
`pre-ghl-oauth` on both remotes.
**Decision it completes:** D-013 option B — *"Recommending a GHL Marketplace app
(OAuth) over per-sub-account keys before the second client."* The second client
already exists (Alliance Pro Services), so this is overdue rather than early.

---

## 1 · What is wrong today

The Hub talks to GoHighLevel with a **Private Integration token**, and a PIT only
opens the sub-account it was made in. Measured on 17 Sep: the Alliance For
Contractors token gets `401 This location is not accessible from this token!` on
Alliance Pro Services, and the APS token gets the same on AFC.

So `GHL_LOCATION_TOKENS` exists — a `locationId:token` map in the environment
(`lib/ghl/config.ts`, `readLocationTokens`). It works. It also means:

- Every new contractor is a **manual step**: someone opens their sub-account,
  creates a PIT, and pastes it into the host's environment variables.
- Forget it, and that contractor's invoice and email calls 401 — with no sign
  anything is wrong until they try.
- Every token is full API access to a sub-account, sitting in an env var, rotated
  by hand. We rotated one on 19 Sep because it had been shared.
- It does not scale past a handful of contractors, and the agency will have more.

## 2 · What replaces it

One **agency-level Marketplace app**, installed once by the agency owner. It
mints a short-lived access token for *any* sub-account it is installed on:

```
agency refresh token  ──▶  POST /oauth/token          ──▶  agency access token
agency access token   ──▶  POST /oauth/locationToken  ──▶  that location's token
                                                            (short-lived, ~24h)
```

Nothing above the token layer changes. The call sites already ask for "this
location's credential" and are handed one.

There are **two halves**, and they are independent:

| | What it fixes | Needed for the ask |
|---|---|---|
| **Half 1 — agency OAuth** | API access to every sub-account with no PIT | **Yes. This is the whole ask.** |
| **Half 2 — Marketplace SSO** | *Who* the contractor is — named people instead of one session per sub-account | No. Separate decision, §9. |

This plan builds **Half 1**. Half 2 is described so the shape is known before we
commit to it, not so it ships with this.

## 3 · What changes, and what does not

**For contractors: nothing visible.** Same menu item in their own sub-account,
same landing, same data. That is the point.

**For whoever runs the accounts:**

- Adding a contractor becomes zero configuration.
- `GHL_LOCATION_TOKENS` stops growing, then gets deleted once the install is
  proven.
- A contractor added to the agency is covered automatically.

**For the system:**

- One agency credential replaces N per-sub-account keys. That is the trade:
  fewer moving parts, but that credential can reach every sub-account, so the
  app's own tenancy checks become the only wall between contractors. They exist
  and are tested — they simply become more load-bearing. See §7.
- Live tokens move into the Hub database, because they rotate. That table is as
  sensitive as the env vars are now.
- **Failure modes shift.** Today a bad key breaks one contractor. After, a broken
  refresh breaks everyone. Hence the fallback in §6 and the alerting in §7.
- Location verification at sign-in changes from *"can we fetch this location with
  our token"* to *"is this location one the app is installed on"* — which is a
  stronger check, not a weaker one.

**What does not change at all:** BuildSuite reads (Supabase, read-only forever),
the field-crew password sign-in, the homeowner code sign-in, the session cookie
format, the permissions matrix, and every visibility rule.

## 4 · The build

The seam is already there. `lib/ghl/location.ts` declares:

```ts
export interface TokenResolver {
  readonly kind: 'development' | 'oauth';
  resolve(locationId: string): Promise<string | null>;
}
```

with a comment saying a different resolver returns that location's OAuth token
"and nothing above this file changes". This plan writes that resolver.

| # | Step | State |
|---|---|---|
| 1 | **Migration 0016** — the agency install row, with the claim columns. Additive; creates a table and touches nothing that exists. | Written. **You run it.** |
| 2 | **Install routes** — `/api/connect/start` and `/api/connect/callback`. Contractor-only, signed `state`, and the callback stores the refresh token without switching anything on. | Done |
| 3 | **Agency token manager** — refresh behind a single-writer claim, so two instances cannot rotate at once and invalidate each other. Same pattern as 0014. | Done |
| 4 | **`OauthTokenResolver`** — `POST /oauth/locationToken` per sub-account, cached until shortly before expiry, refusing anything that is not the location asked for. | Done |
| 5 | **Wire the call sites** — invoices, email, the invoicing rail, and sign-in verification, all through one function with the PIT fallback. | Done (8 call sites) |
| 6 | **Tests** — 24, including the rollback asserted against `withLocationToken` itself. Eight bugs reintroduced on purpose; each caught by the test meant for it. | Done |
| 7 | **Install and prove it** — create the app, install at agency level, switch on, watch one contractor, then a second sub-account. | **Needs the app to exist** |
| 8 | **Delete the PIT path** — after both pass, and not the same day. | Not started |

**One thing deliberately left alone:** `lib/data/source.ts` swaps in the
session's location while keeping the default token — the very pattern the
guardrail forbids in the other three callers. It is behind
`canReadProjectObject`, which needs `GHL_PROJECT_OBJECT_KEY`, and that has never
been set: the Project custom-object read was never turned on, and BuildSuite is
the data source. Making it async would ripple through every page for a branch
nothing reaches. **If that key is ever set, this needs the same treatment
first** — otherwise it reads one contractor's location with another's token.

Steps 1–7 are additive. Until `GHL_OAUTH_ENABLED=true`, every one of them is
dead code and production behaves exactly as it does today.

### What is in the repo now

| Written | |
|---|---|
| `supabase/hub/0016_ghl_oauth_tokens.sql` | The install row. Not yet run. |
| `lib/ghl/oauth-config.ts` | App credentials, the switch, the scope list. |
| `lib/hub-db/ghl-oauth.ts` | The row, and the refresh claim. Probes for the table. |
| `lib/ghl/oauth-agency.ts` | Code exchange, refresh, installed locations. |
| `lib/ghl/oauth-location.ts` | `OauthTokenResolver` — a sub-account's own token. |
| `lib/ghl/resolve-config.ts` | The one decision point, with the PIT fallback. |
| `app/api/connect/start`, `/callback` | The install flow, contractor-only, signed state. |
| `lib/ghl/oauth.test.ts`, `resolve-config.test.ts` | 24 tests. Eight deliberate breaks, each caught. |

### The variables to set

| Variable | |
|---|---|
| `GHL_OAUTH_CLIENT_ID` | From the Marketplace app. Public. |
| `GHL_OAUTH_CLIENT_SECRET` | From the Marketplace app. **Secret.** |
| `GHL_OAUTH_REDIRECT_URI` | `https://<the live domain>/api/connect/callback` — must match the app exactly. **No "ghl" in this path:** GoHighLevel refuses a redirect URL containing a reference to itself when the app is white-labelled (hit on 2026-09-23). |
| `GHL_OAUTH_APP_ID` | Optional. Only for reading the installed-location list. |
| `GHL_AGENCY_COMPANY_ID` | Optional. A check that we installed into the right agency. |
| `GHL_OAUTH_ENABLED` | `true` to use it. **Set this last, on its own.** |

To install once the variables are in place: sign in as a contractor and open
`/api/connect/start`. The callback page says what happened and changes nothing
by itself.

### The table (sketch — final form in the migration)

| Column | Why |
|---|---|
| `company_id` | The agency. One row. |
| `refresh_token` | Rotates on every refresh. The only long-lived secret. |
| `access_token`, `expires_at` | Agency-level, short-lived. |
| `claimed_at`, `claimed_by` | Single-writer lock during refresh. |
| `installed_locations` | Cached list; refreshed on a schedule and on install. |

Location tokens are cached **in memory per instance**, not in the database — they
live ~24h, cost one call to re-mint, and keeping them out of the database keeps
the blast radius to one row.

## 5 · Scopes

The app needs exactly what the Hub already calls. From the source:

| Call | Where |
|---|---|
| `GET /locations/{id}` | sign-in verification |
| `GET /contacts/…`, `POST /contacts/…` | client and crew records |
| `POST /conversations/messages`, `/emails` | appointment and PM email |
| `/objects/{key}/records/search` | the Project custom object |
| `/invoices`, `/invoices/{id}/send`, `/invoices/template` | the invoice rail |

I will list the exact scope strings against the app's scope picker before you
approve them — GHL's names do not always match the endpoint paths, and a guess
here costs a re-install. **A missing scope is a 401 on that one endpoint and
nothing worse**, so this is recoverable, not fatal.

## 6 · Rollout

1. App created, installed on the agency, `GHL_OAUTH_ENABLED` **off**. Nothing
   changes. Verify the install landed and the installed-locations list is right.
2. Flag on. The resolver is tried first; **on any failure it falls back to the
   PIT for that location** and logs loudly. Both paths live, so a bad refresh is
   an alert rather than an outage.
3. Watch one contractor through a real invoice send.
4. Watch the second sub-account (APS) — the one that proves cross-tenant access
   actually works, since that is what PITs cannot do.
5. Fallback removed, `GHL_LOCATION_TOKENS` emptied, PIT env vars deleted.

Step 5 is a separate, deliberate change. Not the same day as step 2.

## 7 · The risks, stated plainly

| Risk | What we do about it |
|---|---|
| **One credential reaches every sub-account.** The agency refresh token is more powerful than any PIT it replaces. | It lives in one database row, never in an env var, never in the repo. The app's tenancy checks (`tenantScopeFor`, `hubScopeOfProject`) are unchanged and are what actually separate contractors — they always were. |
| **A broken refresh breaks everyone**, not one contractor. | Single-writer claim so instances cannot fight; PIT fallback through step 4; a refresh failure logs at error level with the agency id so it is findable. |
| **Refresh tokens rotate.** Losing one means re-installing. | The claim pattern, plus we never discard the old token until the new one is written. |
| **Tokens in the database.** | Same handling as everything else in the Hub: service-role access only, never returned to a client, never logged. |
| **The app is installed on sub-accounts we do not serve.** | Install list is the gate at sign-in; a location with no BuildSuite `auth_profiles` still gets no session, exactly as today. |

## 8 · What I can verify, and what I cannot

I can build and test all of it against a stand-in GHL server, including refresh,
the single-writer claim, the location-token exchange, 401-and-retry, and every
guardrail. That is how the rest of the Hub is tested.

**I cannot test the real handshake until the app exists** — it needs the client
secret and one live install. So the last step is you and me doing one install
together and watching a single contractor's invoice call succeed on the new
path. I will not report this working on the strength of the fake.

## 9 · Half 2 — SSO, for later

Half 1 removes the keys. It does **not** answer *who* a contractor is: today the
identity is the sub-account, so everyone on a contractor's staff shares one
session and nothing is attributable to a person. That is the largest gap in
`AUTHENTICATION-AUDIT.md`.

GoHighLevel's Marketplace SSO fixes it — the app receives encrypted user data
(name, email, user id, role) for whoever is signed in. Two conditions come with
it:

- The Hub has to be embedded **as a Custom Page inside GoHighLevel**, not opened
  as a menu link to an external site. SSO only reaches an embedded app.
- Cookies in an iframe need `SameSite=None; Secure`, which is a change to
  `lib/session.ts` (`sameSite: 'lax'` today) and affects every role, not just
  contractors.

Worth doing. Not worth bundling into the change that removes the keys.

---

## 10 · What I need from you

1. **The Marketplace app created** in the agency, by whoever owns it. Client id,
   client secret and (later) SSO key go straight into the host's environment
   variables. **Do not paste the secret into a chat or the repo.** Alternatively,
   give me agency access and I will create it.
2. **Where this runs.** Railway or Vercel? The redirect URL is baked into the app
   and must match the live domain, so this is decided *before* the app is
   created, not after.
3. **Who clicks Install**, at agency level — and whether it installs to all
   sub-accounts or a chosen list.
4. **Migration 0016 run**, the same way you ran 0012, 0014 and 0015.
5. **Scope approval**, once I put the exact list in front of you (§5).
6. **A decision on the fallback:** keep the PIT path behind the flag until the
   first contractor is proven. I recommend yes.

## 11 · Also still open, unrelated to this

- Migration `0015_task_links_and_client_actions.sql` has not been run.
- A payment gateway connected in GoHighLevel, before any real payment.
- `docs/AUTHENTICATION-AUDIT.md`, four EODs and this file are uncommitted.
