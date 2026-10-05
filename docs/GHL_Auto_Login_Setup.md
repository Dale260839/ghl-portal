# Signing in from GoHighLevel

**Goal:** a contractor signed in to GHL clicks Project Hub in the sidebar and
lands on their dashboard. No second password.

**This replaces the Custom Menu Link setup described here until 2026-10-05.**
That approach no longer works and cannot be made to work — see
[Why the menu link is gone](#why-the-menu-link-is-gone). If you are reading an
older copy of this file, every instruction in it about `{{location.id}}` and
"Open in: New tab" is wrong.

---

## How it works now

1. A **Marketplace Custom Page** renders the Hub in an iframe inside GHL, at
   `/auth/crm`.
2. The page asks the parent frame for user context (`REQUEST_USER_DATA`).
3. GoHighLevel answers with a payload encrypted under the app's **shared
   secret** — which only our server holds.
4. The server decrypts it, checks it belongs to **our agency**, and reads the
   sub-account from `activeLocation`.
5. It finds every BuildSuite profile for that sub-account and issues a signed
   session scoped to them.

The sub-account is never taken from the URL. A query parameter is a *claim* —
anybody can type one. The payload is *proof*, because producing it requires the
secret.

---

## Why the menu link is gone

Until `ec2e9b1` the Hub accepted a plain `?locationId=…` link, "verified" by
calling GHL with **our own** credential to confirm the sub-account existed.

That is not authentication of the caller. It confirms the sub-account is real;
it says nothing about who is asking. Anyone who learned the address could have
substituted another contractor's `locationId` and been handed their projects —
and with 149 sub-accounts live, their choice of which.

So production now requires the encrypted user context, or a signed link.

**Measured 2026-10-05:** a Custom Menu Link in **Embedded Page** mode — a real
iframe, trusted parent origin — was sent `REQUEST_USER_DATA` and never answered
within 10 seconds. Only a Marketplace **Custom Page** serves user context. The
menu link was deleted; do not recreate it.

---

## Setting it up

### 1. Server configuration

Three variables, server-only, in the production environment:

| Variable | Where it comes from |
|---|---|
| `GHL_APP_SHARED_SECRET` | Marketplace app → **Shared secret** section. *Not* a client key — that is a different credential with a different job. |
| `GHL_SSO_COMPANY_ID` | The agency id **as the payload reports it** — see the trap below. |
| `GHL_PARENT_ORIGINS` | Optional. Defaults to `https://app.gohighlevel.com,https://app.allianceforcontractors.com`. Set it only for a different white-label origin. |

**The trap, and it cost an evening.** The agency id is also in
`hub_ghl_agency.company_id`, but do not transcribe it by eye from anywhere. It
contains characters that are indistinguishable in many fonts — the live value
`19WlZc8l7w03KWCJKK2E` has lowercase `l` where a capital `I` is the obvious
reading. A single wrong character fails every sign-in with a message that does
not say why. Copy it as text, or read it from the refusal log, which prints
both the payload's value and the configured one side by side.

### 2. The Custom Page

Marketplace app → **BUILD → Modules → Custom Page**. The live version is
read-only; create a draft version first or the button stays greyed out.

| Field | Value |
|---|---|
| **Title** | Project Hub |
| **Placement** | Left menu navigation |
| **Visible on** | Both agency & sub-account left navigation menus |
| **Live URL** | `https://<domain>/auth/crm` |
| **Testing URL** | the same URL — a stale preview hostname here means testing a build you did not ship |
| **Allow camera** | On. The field uploader uses `capture="environment"`, which some mobile browsers gate behind the iframe's camera policy. |
| **Allow microphone** | Off. Nothing uses it. |

**No query string and no merge field.** Custom Pages do not substitute
`{{location.id}}`, and an uninterpolated one is refused on purpose rather than
silently ignored.

Publish the draft version. Check **Advanced Settings → Auth** first: the
**Default client key** must still be the one the existing installs were made
under, or new installs stop matching the rows in `hub_ghl_oauth`.

---

## When it refuses

The browser always says the same sentence. The reason goes to the server log,
where only an operator can read it — telling a caller which check failed hands
them a narrowing game.

Search the runtime logs for `[auth]`:

| Log reason | Cause | Fix |
|---|---|---|
| `not_configured` | A variable is missing or did not reach this build | Set it, then **redeploy** — env changes do not reach a running build |
| `malformed_envelope` | Not a HighLevel user context at all | Wrong field sent, or the frame answered with something else |
| `undecryptable` | **The shared secret is wrong** | Re-copy it from the app's Shared secret section |
| `wrong_company` | **The agency id is wrong.** The line prints both values | Paste the payload's value into `GHL_SSO_COMPANY_ID` |
| `unexpected_shape` | Right agency, unrecognised user payload | Needs a code change — raise it |
| `location_mismatch` | The URL claimed one sub-account, the payload proved another | Remove the parameter from the Custom Page URL |

What the contractor sees, and what it means:

| On screen | Meaning |
|---|---|
| "Sign-in from GoHighLevel is not configured yet." | Opened top-level, not in a frame, with no signed link |
| "This link is missing its sub-account." | Top-level with no `locationId` — a Custom Page never produces this |
| "GoHighLevel did not fill in the sub-account." | An uninterpolated `{{location.id}}` arrived |
| "Open Project Hub inside the configured GoHighLevel custom page." | The parent origin is not in `GHL_PARENT_ORIGINS` |
| "GoHighLevel did not respond…" | The frame ignored `REQUEST_USER_DATA` for 10s — almost certainly not a Custom Page |
| "Could not verify your GoHighLevel identity." | The handshake worked; decryption or the agency check failed. **Read the log.** |
| "…has no BuildSuite projects linked to it yet" | Authentication fully succeeded. Only the tenant lookup is empty. |

---

## The other door

`GHL_MENU_LINK_SECRET` still exists and still works: a trusted bridge signs
`locationId`, `userId`, `email` and `timestamp` with HMAC-SHA256, and a signed
link is accepted top-level, frame or no frame, within 5 minutes of issue.

Nothing produces those signatures today. GoHighLevel does not sign merge
fields, so using this means building the bridge. It is the fallback if the
Custom Page path is ever withdrawn, not a second option to configure now.
