# Turning on auto-login from GoHighLevel

**Goal:** a contractor signed in to GHL clicks a menu item and lands in the
Project Hub already signed in. No second password.

The code is built, tested, and deployed. What's left is configuration in GHL and
two environment variables.

---

## How it works

1. You add a **Custom Menu Link** in GHL pointing at the Hub.
2. GHL appends who and where as merge fields: `locationId`, `userId`, `email`.
3. The Hub takes those as a **claim** and checks it against the GHL API using our
   own credential — is that user really in that sub-account?
4. If yes, it looks the user up in BuildSuite by email and location to find which
   contractor's data they may see, then issues a signed session.

**Why step 3 exists.** GHL doesn't sign menu-link parameters — they arrive as
plain text in a URL. Without checking them, anyone who learned the address could
put a different `locationId` in it and be handed that contractor's projects.
Verifying against the API is what turns a claim into proof.

---

## What to set up

### 1. Create the Custom Menu Link

**Settings → Custom Menu Links → Add.** At agency level, so it appears in every
sub-account and new clients need no extra work.

| Field | Value |
|---|---|
| **Name** | Project Hub *(whatever you want on the menu)* |
| **URL** | `https://<your-domain>/api/auth/ghl?locationId={{location.id}}&userId={{user.id}}&email={{user.email}}` |
| **Open in** | New tab, to start with |

Those three merge fields are required. The Hub refuses a landing that's missing
`locationId` or `userId`, and reports which one so a mistyped link looks like a
mistyped link rather than a security failure.

**On "Open in":** a new tab is simpler. An iframe feels more integrated but adds
cookie and framing constraints — worth trying only once the new-tab version works.

### 2. Set two environment variables

On the Vercel project:

```
GHL_LOCATION_ID          the sub-account's ID
GHL_PROJECT_OBJECT_KEY   the Project custom object's key
```

Auto-login needs the first one; the second is what also switches the dashboard
from sample data to live GHL records. Both come from the GHL account — the
Location ID is in the URL when you're inside a sub-account.

**Then redeploy.** Environment variables are read at build time, so an existing
deployment won't pick them up.

### 3. Test it

Sign in to GHL, click the menu item. You should land on the dashboard already
signed in.

**If it refuses**, the message says which step failed:

| Message | Meaning |
|---|---|
| "The link did not identify a sub-account / user" | A merge field is missing or misspelled in the menu link URL |
| "That link doesn't match a user in this sub-account" | Verification worked and said no. Either the link was tampered with, or the token is scoped to a different sub-account. |
| "Couldn't reach GoHighLevel to confirm your account" | GHL was unreachable. **We refuse rather than let people through** — an outage must not become an open door. |
| "Not linked to a BuildSuite profile yet" | Signed in fine, but that email has no matching BuildSuite profile for this location, so there's no data to show them |
| "Sign-in from GoHighLevel is not configured yet" | `GHL_LOCATION_ID` isn't set |

---

## Two limits worth knowing

**One sub-account for now.** A private integration token is scoped to a single
sub-account, so verification only works for that one. Serving several means a
GHL Marketplace app with OAuth — recorded as D-013, and worth doing before the
second client rather than after.

**A leaked URL still works.** Verification proves the user exists in the
location; it can't prove the person holding the browser *is* that user. Anyone
with the full link could use it until the setup changes. GHL's Marketplace SSO —
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
