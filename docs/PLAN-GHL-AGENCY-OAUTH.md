# Plan — remove the per-contractor PIT keys

**Goal:** onboarding a contractor stops involving a credential. No Private
Integration token to create, copy, paste into the deployment, or rotate.

**Status:** **built and switched off**, 2026-09-23. Nothing changes for anyone
until `GHL_OAUTH_ENABLED=true`. 1,147 tests green, typecheck and build clean.
**Rollback:** `docs/ROLLBACK-GHL-OAUTH.md`. The state before this work is tagged
`pre-ghl-oauth` on both remotes.
**Decision it completes:** D-013 option B — *"Recommending a GHL Marketplace app
(OAuth) over per-sub-account keys before the second client."*

---

## 1 · What is wrong today

The Hub talks to GoHighLevel with a **Private Integration token**, and a PIT only
opens the sub-account it was made in. Measured on 17 Sep: the Alliance For
Contractors token gets `401 This location is not accessible from this token!` on
Alliance Pro Services, and the APS token gets the same on AFC.

So `GHL_LOCATION_TOKENS` exists — a `locationId:token` map in the environment
(`lib/ghl/config.ts`, `readLocationTokens`). It works, and it means every new
contractor is **four manual steps**: create a token in their sub-account, copy
it, add it to the deployment, redeploy. Miss one and their invoices 401 with
nothing to say so. Every entry is full API access to somebody's CRM, sitting in
an environment variable, rotated by hand. We rotated one on 19 Sep because it
had been shared.

## 2 · What replaces it

A **Marketplace app**, installed on each sub-account. Installing it hands us
that sub-account's own tokens, which then refresh themselves forever.

| | Today | After |
|---|---|---|
| Create a PIT in the sub-account | yes | no |
| Copy a key into the deployment | yes | no |
| Redeploy to pick it up | yes | no |
| Click install once | — | **yes** |

Four manual steps involving a live credential become one click, done by an
agency admin from inside the sub-account.

### Why not one agency install — the zero-click version

That was the original plan, and GoHighLevel does not allow it. The scopes the
Hub needs — contacts, conversations, invoices — are greyed out on an
agency-targeted app, with the tooltip:

> **Requires Sub-Account token.** This scope works with Location-level tokens
> only, which are issued when a Sub-Account installs your app.

Confirmed in the scope picker on 2026-09-23, after the agency app had been
created. The agency app is left as a draft: if GoHighLevel ever opens those
scopes to agency installs, `POST /oauth/locationToken` is the zero-click version
and the code is shaped to take it.

One consolation: the per-sub-account design is **simpler** — no agency token, no
token minting, one row keyed by the sub-account it belongs to, which is the
tenant boundary anyway.

## 3 · What changes, and what does not

**For contractors: nothing visible.** Same menu item in their own sub-account,
same landing, same data.

**For whoever onboards them:** one click instead of four steps and a key.
`GHL_LOCATION_TOKENS` stops growing, then gets deleted once the install is
proven.

**For the system:** tokens move into the Hub database, because they rotate. A
row there is as sensitive as an env var is now, and there is one per contractor
rather than one credential covering everyone — the same blast radius as today,
which the agency design would have widened.

**What does not change at all:** BuildSuite reads (read-only forever), the
field-crew password sign-in, the homeowner code sign-in, the session cookie
format, the permissions matrix, and every visibility rule.

## 4 · The build

The seam was already there. `lib/ghl/location.ts` has declared this since
August:

```ts
export interface TokenResolver {
  readonly kind: 'development' | 'oauth';
  resolve(locationId: string): Promise<string | null>;
}
```

— with a comment saying a different resolver would return that location's OAuth
token and nothing above it would change. It does, and nothing did.

| # | Step | State |
|---|---|---|
| 1 | **Migration 0016** — one row per sub-account, with the refresh claim. Additive; creates a table and touches nothing that exists. | Written. **You run it.** |
| 2 | **Install routes** — `/api/connect/start` and `/api/connect/callback`. Contractor-only, signed `state`, and the callback stores the tokens without switching anything on. | Done |
| 3 | **Token keeper** — refresh behind a single-writer claim, so two instances cannot rotate one row at once and invalidate each other. Same pattern as 0014. | Done |
| 4 | **`OauthTokenResolver`** — that sub-account's token, cached for at most an hour, refusing anything that is not the location asked for. | Done |
| 5 | **Wire the call sites** — invoices, email, the invoicing rail and sign-in verification, all through one function with the PIT fallback. | Done (8 call sites) |
| 6 | **Tests** — 25, including the rollback asserted against `withLocationToken` itself. Nine bugs reintroduced on purpose; each caught by the test meant for it. | Done |
| 7 | **Install and prove it** — install on one sub-account, switch on, watch a real invoice, then do the second sub-account. | **Next** |
| 8 | **Delete the PIT path** — after both pass, and not the same day. | Not started |

**One thing deliberately left alone:** `lib/data/source.ts` swaps in the
session's location while keeping the default token — the very pattern the
guardrail forbids in the other three callers. It is behind `canReadProjectObject`,
which needs `GHL_PROJECT_OBJECT_KEY`, and that has never been set: the Project
custom-object read was never turned on, and BuildSuite is the data source.
Making it async would ripple through every page for a branch nothing reaches.
**If that key is ever set, this needs the same treatment first** — otherwise it
reads one contractor's location with another's token. The Objects scopes are not
requested for the same reason.

### What is in the repo

| | |
|---|---|
| `supabase/hub/0016_ghl_oauth_tokens.sql` | One row per sub-account. Not yet run. |
| `lib/ghl/oauth-config.ts` | App credentials, the switch, the scope list. |
| `lib/hub-db/ghl-oauth.ts` | The row, and the refresh claim. Probes for the table. |
| `lib/ghl/oauth-tokens.ts` | Code exchange and refresh. |
| `lib/ghl/oauth-location.ts` | `OauthTokenResolver` — a sub-account's own token. |
| `lib/ghl/resolve-config.ts` | The one decision point, with the PIT fallback. |
| `app/api/connect/start`, `/callback` | The install flow, contractor-only, signed state. |
| `lib/ghl/oauth.test.ts`, `resolve-config.test.ts` | 25 tests. |

### The variables to set

| Variable | |
|---|---|
| `GHL_OAUTH_CLIENT_ID` | From the Marketplace app. Public. |
| `GHL_OAUTH_CLIENT_SECRET` | From the Marketplace app. **Secret.** |
| `GHL_OAUTH_REDIRECT_URI` | `https://<the live domain>/api/connect/callback`. **No "ghl" in this path:** a white-labelled app refuses a redirect URL that names the platform (hit on 2026-09-23). |
| `GHL_OAUTH_ENABLED` | `true` to use it. **Set this last, on its own.** |

To install: sign in as a contractor in the sub-account, open `/api/connect/start`,
approve. The callback page says what happened and changes nothing by itself.

## 5 · The app, as configured

- **Private**, **Sub-Account** target, **Agency only** may install, white-label.
- Redirect URL as above.
- **Seven scopes**, each traced to a call in the code:
  `locations.readonly` (verify a sub-account at sign-in), `contacts.readonly` +
  `contacts.write` (find or create the person an email goes to),
  `conversations.write` + `conversations/message.write` (send it),
  `invoices.readonly` + `invoices.write` (the Payments screen and the rail).
- Nothing under Objects, for the reason in §4.

## 6 · Rollout

1. App created, variables set, `GHL_OAUTH_ENABLED` **off**. Nothing changes.
2. Install on one sub-account. Still nothing changes.
3. Flag on. The install is tried first; **on any failure it falls back to that
   sub-account's PIT** and logs which. Both paths live, so a bad install is an
   alert rather than an outage.
4. Watch that contractor send a real invoice.
5. Install on the second sub-account (APS) and repeat — the cross-sub-account
   case is the one PITs cannot do.
6. Fallback removed, `GHL_LOCATION_TOKENS` emptied, PIT env vars deleted.

Step 6 is a separate, deliberate change. Not the same day as step 3.

## 7 · The risks, stated plainly

| Risk | What we do about it |
|---|---|
| **Refresh tokens rotate.** Two instances refreshing one row leave one holding a dead token — that contractor's whole API access. | A database claim, so only one instance refreshes; the others wait and read the winner's token. The claim expires, so a crash cannot lock a contractor out for ever. |
| **Tokens in the database.** | Service-role access only, RLS on with no policies, never returned to a client, never logged. |
| **A token dies before its stated expiry** (uninstalled, re-installed). | The cache is capped at an hour whatever GoHighLevel says, so the worst case self-heals in an hour. |
| **An install answering for the wrong sub-account.** | Refused and not stored, both at install and at refresh. Two tests. |
| **A contractor uninstalls the app.** | Their calls fall back to their PIT if one exists, or 401 exactly as they would today. Logged by location. |

## 8 · What I can verify, and what I cannot

Everything above is tested against a stand-in GoHighLevel and a stand-in Hub,
including refresh, the claim, cross-tenant refusal, and every fallback.

**The real handshake cannot be tested until the app exists** — it needs the
client secret and one live install. The last step is doing one install together
and watching a single contractor's invoice succeed on the new path.

## 9 · Later, and separately — SSO

This removes the keys. It does not answer *who* a contractor is: the identity is
the sub-account, so everyone on their staff shares one session and nothing is
attributable to a person. That is the largest gap in `AUTHENTICATION-AUDIT.md`.

GoHighLevel's Marketplace SSO fixes it, at two costs: the Hub has to be embedded
as a Custom Page inside GoHighLevel, and iframe cookies need
`SameSite=None; Secure` — a change to the *shared* session in `lib/session.ts`,
so it touches crew and homeowners too. Worth doing. Not worth bundling with this.
