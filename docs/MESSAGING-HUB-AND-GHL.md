# Messaging between Project Hub and GoHighLevel

**Documented:** 2026-09-10, from the code as it stands.
**Scope:** every message, notification and event that crosses the boundary in
either direction — what is wired, what is stubbed, and what only logs.

---

## 1 · The boundary rule this all sits under

D4 §5: **GoHighLevel is the operational system of record after handoff.** The Hub
reads that state; it does not originate it. And D4 §5 again: **stage completion
is never set from the Hub.**

So the traffic is deliberately lopsided. Almost everything crossing the boundary
is the Hub *reading* GHL or GHL *telling* the Hub. There are exactly **two**
things the Hub writes into GoHighLevel, and both are listed in §3.

The only BuildSuite ↔ GHL channels are the Send-to-CRM handoff (§8.2) and the
scheduled stage sync-back (§8.3). **The portals never call BuildSuite directly.**

---

## 2 · The three wires

```
                    ┌──────────────────────────────────────────┐
                    │              PROJECT HUB                 │
                    └──────────────────────────────────────────┘
   READ (§2.1)  <──────────  GhlClient           custom objects, opportunities
                             lib/ghl/client.ts   mapper.ts -> Project

   WRITE (§3)   ──────────>  GhlEmail            POST /conversations/messages
                             GhlInvoices         POST /invoices

   INBOUND (§4) ──────────>  /api/ghl/webhook    verify -> route -> log
                             webhook-routing.ts  event type -> WF1…WF8
```

### 2.1 Reading — `lib/ghl/client.ts`

Retries with backoff, distinguishes auth from rate-limit from not-found
(`errors.ts`), and is scoped to one location (`location.ts` — a
`LocationScopeError` rather than a cross-tenant read).

`mapper.ts` turns a GHL custom-object record into a `Project` through
`FIELD_KEYS`. **§3.6: the join is the shared key field, never a name or title.**

**Blocked:** reading the Project custom object needs `GHL_PROJECT_OBJECT_KEY`,
and `canReadProjectObject(config)` reports whether it is set.

---

## 3 · What the Hub actually sends into GoHighLevel

Exactly two things, and only one of them can reach a homeowner.

### 3.1 Email — `lib/ghl/email.ts`

`POST /conversations/messages` with `type: 'Email'`, after
`findOrCreateContact` resolves the address.

GHL rather than a new provider, because it already holds the contact and a reply
lands in the thread the contractor already uses — no second deliverability
reputation to build.

**Three guards, because this reaches a real inbox and cannot be recalled:**

| Guard | |
|---|---|
| `GHL_SEND_EMAIL=true` | Off by default. Without it, `send()` returns `{ sent: false, reason: 'disabled' }`. |
| Exact-match lookup | A contact is created only when an exact email match finds none. Nothing guesses. |
| Caller supplies the address | Nothing here iterates a list. There is no bulk path. |

**What is sent today:** the **field-crew invitation** and nothing else.
`invitationEmail()` is the only template, and since 2026-09-10 it is field-crew
only — homeowners are no longer invited (`docs/CLIENT-LOGIN-PROJECT-CODE.md`).

**The homeowner's project code is NOT sent from here.** That email is a
BuildSuite automation, fired on signature, outside this repo entirely.

### 3.2 Invoices — `lib/ghl/invoices.ts`

Creates a **draft** invoice and stops. Nobody is emailed and nothing is charged
until a person opens GHL and sends it — the rule from Chris: the send is always
a human step so the contractor can add a note first.

Guarded against double-invoicing three ways: a `SubmitButton` that disables on
submit, an `external_id is null` filter, and a unique index. See
`docs/INVOICE-AND-PAYMENT.md`.

---

## 4 · What GoHighLevel sends the Hub

`POST /api/ghl/webhook`. Three separate questions in three separate modules:

| Module | Question | Notes |
|---|---|---|
| `webhook.ts` | Is this really GHL? | Signature over `timestamp + rawBody`, 300s tolerance, plus a replay store. Refuses **before parsing**. |
| `webhook-routing.ts` | What does it mean? | Event type -> `WF1`…`WF8`. |
| `wf*.ts` planners | What should happen? | Pure functions returning an `Effect[]`. |

**Two behaviours worth knowing:**

- **An unrecognised event is accepted and ignored, never refused.** A webhook
  that 4xxs on unknown types gets switched off by whoever reads the delivery
  log, and then the handled ones stop arriving too. The unmatched branch logs
  the type precisely, so the first real delivery tells us the true names.
- **A verified event with no `locationId` is refused.** It cannot be scoped to a
  tenant, and every planner needs one.

### The event names are guesses

`BY_TYPE` was written from documented shapes plus obvious variants, and
`normalise()` makes matching tolerant of case and separators so a near-miss
still lands. **No real webhook has ever been received** — the secret does not
exist yet. Replace the map with what GHL actually sends once one arrives.

### The route stops at the seam, deliberately

It verifies, routes and logs. It does **not** execute the planner, because the
planners need real GHL record data and reading that needs the object key we do
not have. Executing against a payload shape nobody has seen would be guessing.

---

## 5 · Notifications: what "notify the client" currently means

**This is the finding most likely to surprise someone.**

The workflows emit notification effects — `NotifyClient`, `NotifyTeam`,
`NotifyInternal`, `NotifyAccounting`. In production, `lib/actions.ts` executes
those plans against **`fixturePorts`**, and `fixturePorts` handles all four by
writing a line to the server console:

```
NotifyInternal: (e) => log(e, e.message),
NotifyTeam:     (e) => log(e, e.message),
NotifyClient:   (e) => log(e, e.message),
```

So when a PM publishes a field update, WF4 fires correctly, the update becomes
visible in the portal, and **the homeowner is not emailed.** The terminal says
`[workflow] NotifyClient — …` and that is the whole of it.

This is honest scaffolding, and the comment in `fixture-ports.ts` says so: the
effects are logged "rather than silently dropped" so a demo shows what *would*
have happened. But nothing in the UI tells the contractor the notification did
not go, and a contractor watching a homeowner not respond will reasonably assume
the homeowner ignored them.

**To close it:** a `ghlPorts` module implementing the same `EffectHandlers`
type, routing `NotifyClient` to `GhlEmail.send()`. The workflows do not change —
that is what the port boundary is for. Needed first: a template per notification
(there is only `invitationEmail` today), and a decision on whether the client
portal's own feed is sufficient notice for some of them.

---

## 6 · Client messaging — built on `hub_messages`, 2026-09-11

**This section said the opposite yesterday, and was wrong in two ways.**

It claimed *"there is no `hub_messages` table and no write path anywhere."* The
second half was true. **The first half was not** — `hub_messages` has existed
since migration 0001, with `project_id`, `contractor_id`, `author`,
`author_role`, `body` and `client_visible`, and a comment already spelling out
the rule it exists to keep:

> Internal by default. A crew↔PM thread must never surface to a homeowner, and
> a homeowner's message must never surface to the crew unless a PM says.

The table was there from the start; only the module was missing. Recorded
plainly because a document that says a thing does not exist is how a second one
gets built beside it.

### And the decision this section posed has been made

It framed *where messaging lives* as an open §16 question — GoHighLevel
conversations, or a Hub table — and declined to answer it. **The other side
answered it on 2026-09-11 (`028cb5b`): a Hub table.** `lib/hub-db/messages.ts`
wires all three screens to read and write it.

That is the option this document listed second, and the trade-off it named still
holds: the conversation now lives in two systems, which is the thing the
invitation email was routed through GHL specifically to avoid. Worth revisiting
if homeowners start replying to Hub notifications by email — not worth
re-opening now.

### The shape of it

`HubMessages` follows the same pattern as every other Hub repository:
`listForProject`, `post`, `release`, `archive`, each asserting the contractor
and filtering on it, archiving rather than deleting.

The two switches that governed the read still govern it: `clientPortalEnabled`,
and §6.1's `allowClientMessaging`, which lets a contractor turn client messaging
off entirely. `client_visible` defaults to **false** on the column, so a crew
thread is internal unless someone releases it.

---

## 7 · Summary — what works today

| | Direction | Status |
|---|---|---|
| Read projects / opportunities | GHL -> Hub | Works. Blocked only on `GHL_PROJECT_OBJECT_KEY`. |
| Field-crew invitation email | Hub -> GHL | **Works**, behind `GHL_SEND_EMAIL=true`. |
| Draft invoice creation | Hub -> GHL | **Works**. Draft only; sending stays a human step. |
| Webhook verification + routing | GHL -> Hub | Works. **No real event received yet**; names are inferred. |
| Webhook -> planner execution | GHL -> Hub | **Not wired.** Stops at the seam by design. |
| `NotifyClient` and friends | Hub -> person | **Logs only.** Nothing is sent. |
| Client portal messaging | both | **Built 2026-09-11** on `hub_messages` — see §6. Stays inside the Hub; it is not mirrored to GHL conversations. |
| Homeowner's project code email | BuildSuite -> homeowner | Works — **outside this repo**. |
