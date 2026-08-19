# Turning on auto-login from GoHighLevel

**Goal:** a contractor signed in to GHL clicks a menu item and lands in the
Project Hub already signed in. No second password.

Built, tested, and **verified end to end against the live Alliance For
Contractors sub-account**. What is left is configuration in GHL.

---

## How it works

1. A **Custom Menu Link** in GHL points at the Hub with one merge field:
   `?locationId={{location.id}}`.
2. The Hub treats that as a **claim** and asks GHL, with our own credential,
   whether the location is real and reachable by us.
3. It then finds every BuildSuite profile belonging to that location — the live
   agency has **two** — and issues a signed session scoped to all of them.
4. Every screen after that shows only that agency's projects.

**Why step 2 exists.** GHL does not sign menu-link parameters; they are plain
text in a URL. Without checking, anyone who learned the address could substitute
another agency's `locationId` and be handed their projects. Verifying is what
turns a claim into proof.

**Verified on 2026-08-19:** landing on `?locationId=IifYfP2B2NUaoDPdsTTa`
resolved both admin profiles and rendered that agency's eight active projects —
and nobody else's.

---

## What to set up

### 1. Create the Custom Menu Link

**Settings → Custom Menu Links → Add.** At agency level, so it appears in every
sub-account and new clients need no extra work.

| Field | Value |
|---|---|
| **Name** | Project Hub *(whatever you want on the menu)* |
| **URL** | `https://<your-domain>/api/auth/ghl?locationId={{location.id}}` |
| **Open in** | New tab, to start with |

One merge field, matching BuildSuite's own menu link exactly — its callback is
`?locationId=IifYfP2B2NUaoDPdsTTa` and nothing else. **The tenant is the
sub-account, not a person**, so a user id is accepted but never required.

**On "Open in":** a new tab is simpler. An iframe feels more integrated but adds
cookie and framing constraints — worth trying only once the new-tab version works.

### 2. Set two environment variables

On the Vercel project:

```
GHL_API_BASE_URL                 https://services.leadconnectorhq.com
GHL_API_VERSION                  2021-07-28
GHL_PRIVATE_INTEGRATION_TOKEN    the sub-account token
```

**Those three are all auto-login needs.** `GHL_PROJECT_OBJECT_KEY` is separate —
it unlocks GHL custom objects, and sign-in deliberately does not wait on it.

**Then redeploy.** Environment variables are read at build time, so an existing
deployment won't pick them up.

### 3. Test it

Sign in to GHL, click the menu item. You should land on the dashboard already
signed in.

**If it refuses**, the message says which step failed:

| Message | Meaning |
|---|---|
| "The link did not identify a sub-account" | The `locationId` merge field is missing or misspelled |
| "That link doesn't match a sub-account we have access to" | Verification worked and said no. Either the link was tampered with, or our token is scoped elsewhere. |
| "Couldn't reach GoHighLevel to confirm your account" | GHL was unreachable. **We refuse rather than let people through** — an outage must not become an open door. |
| "No BuildSuite projects linked to it yet" | The sub-account is real, but no BuildSuite profile points at it, so there is nothing to show |
| "Sign-in from GoHighLevel is not configured yet" | The three variables above are not set |

---

## Two limits worth knowing

**One sub-account for now.** A private integration token is scoped to a single
sub-account, so verification only covers that one. Serving several means a GHL
Marketplace app with OAuth — D-013, and worth doing before the second client
rather than after.

**A leaked URL still works.** Verification proves the location is real; it cannot
prove the person holding the browser came from GoHighLevel. Anyone with the full
link could use it until the setup changes — **and BuildSuite's own callback has
exactly the same property today**, so this is parity, not a regression. GHL's Marketplace SSO —
where GHL hands the page encrypted, signed user data — is the fix, and it's the
same piece of work as multi-tenant tokens. For an internal tool behind a GHL
login this is a reasonable starting point; it isn't where it should end.

---

## What clients get

Homeowners **don't** have GHL logins, so this path isn't theirs. They sign in to
GHL's native Client Portal, and whether that gives us anything we can verify is
still unconfirmed — it's the last open question on the auth design, and it needs
answering before the client portal goes live to real homeowners.

---

## What's already true today

- Sessions are signed, tamper-proof, and expire after eight hours
- Every read is scoped to one contractor, enforced at the data layer
- Editing the session cookie to change contractor fails the signature check
- The whole path is tested, including the forged-location case

The demo accounts on the sign-in page keep working alongside this, so nothing
depends on GHL being configured to show the product.
