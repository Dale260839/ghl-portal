# Project Hub — current state

**Live:** https://project-hub-one-vert.vercel.app
**Updated:** 2026-08-14 · **Tests:** 198 green · **Build:** clean

A plain-language snapshot of where the Project Hub is. For the engineering
handover version, see [session-context.md](session-context.md). For what's
waiting on a decision, see [decisions-for-chris.md](decisions-for-chris.md).

---

## It's deployed

The Hub is live and running. Signing in works, all three experiences render, and
the BuildSuite half is reading real production data.

Verified on the deployment: the sign-in page loads, `/dashboard` correctly
redirects anyone without a session, and the GoHighLevel auto-login endpoint
refuses to issue a session while it's unconfigured — which is the intended
behaviour, not a fault.

**Try it** with any of these. No password; it's a demo sign-in until GHL
auto-login is switched on.

| Sign in as | See |
|---|---|
| `marcus@allianceproservices.com` | Contractor Dashboard |
| `priya@allianceproservices.com` | **A second contractor** — different projects, proves the data is scoped |
| `tony@allianceproservices.com` | Field Interface (mobile) |
| `dana@example.com` | Client Portal — two projects |

---

## What's real and what isn't

| | Status |
|---|---|
| **BuildSuite project data** | **Live.** Read straight from BuildSuite's production database, read-only. |
| Everything else | Sample data, with a banner on every screen saying so. |
| Sign-in | Demo accounts. The GoHighLevel auto-login is built and tested but not switched on. |
| GoHighLevel data | Not connected — needs one configuration value we don't have yet. |

Nothing pretends to be live when it isn't. That's deliberate: a demo that looks
real is how people make decisions on numbers that were never true.

---

## The three experiences

**Contractor Dashboard** — portfolio overview, projects list, project detail with
timeline and financials, the field-update review queue, issues, client-visibility
settings, and the live BuildSuite feed.

**Field Interface** — mobile-first. Today's tasks, and a daily update form with
two separate note fields: one internal, one the client might eventually see.
There is no publish button anywhere on it.

**Client Portal** — progress, schedule, budget summary, published updates, and a
switcher for clients with more than one project.

---

## The thing worth demonstrating

Sign in as **Tony** and submit a daily update, with a note in the internal field.
Sign in as **Marcus** — it's waiting for review, internal note flagged in red,
client summary editable. Edit it and publish. Sign in as **Dana** — the update is
there, showing only what Marcus approved.

The internal note isn't hidden from her by the page. It was never read. Costs,
markup, and margin work the same way: the client view is built from a list of
what's allowed out, so anything new is private until someone deliberately shares
it.

**Second thing worth showing:** sign in as Marcus, then Priya. Completely
different projects, no overlap. Each contractor sees only their own work, and
that's enforced in the data layer rather than the screens.

---

## What's holding things up

| | Waiting on |
|---|---|
| **GoHighLevel data** | One configuration value — the Project object's key from the GHL account |
| **Auto-login from GHL** | The Custom Menu Link being created; the code is built and tested |
| **The shared ID** | A decision. The identifier the plan assumed doesn't exist in BuildSuite; a working alternative already does. |

None of these block each other, and none block using what's deployed today.

---

## Updating it

Every push to the connected repository deploys automatically. Nothing manual.

The environment holds three values — the BuildSuite database URL and key, and a
session signing secret. The signing secret is what makes sign-in tamper-proof; the
app refuses to start in production without it rather than generating one and
quietly logging everyone out on each deploy.

---

## Timeline

Five working days to 21 August.

The screens are built and deployed. What's left is connection, and connection is
where every open item sits. If the GoHighLevel configuration and the shared-ID
decision land early next week, the full chain is demonstrable: signed proposal →
project appears → stage moves → client sees progress.

If they don't, the honest fallback is demonstrating with the BuildSuite half live
and the GoHighLevel half on sample data. Still a real demonstration of the
product — just not the complete loop.
