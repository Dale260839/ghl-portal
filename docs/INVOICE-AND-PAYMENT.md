# How invoicing and payment work

**Updated 2026-09-12.** What is built, what it deliberately does not do, and
where it stops today. Section 0 is the plain-English version, written for Chris.

---

## 0 · For Chris: how templates, Stripe and paying by phone fit together

Asked in the 2026-09-10 huddle. No code here — just how the pieces relate.

**There are three layers, and each one does one job.**

| Layer | Its job | Who touches it |
|---|---|---|
| **Project Hub** | Works out *what* to bill and *when*, from the signed contract's payment schedule. Shows the homeowner their schedule and their invoices. | The contractor, reviewing each stage |
| **GoHighLevel** | Holds the actual invoice, sends it, and records whether it was paid. | The contractor clicks **send** |
| **The payment processor** | Moves the money from the homeowner's card to the contractor's account. | Nobody, day to day — it is connected once |

**Where Stripe fits.** We chose GoHighLevel over Stripe on 9/1 — but that was
a choice about *where invoices live*, not a choice against Stripe. GoHighLevel
does not move money itself; it hands payment to a processor the contractor
connects in their GoHighLevel payment settings, and Stripe is the usual one.
So in practice it is **GoHighLevel on top, Stripe underneath**. The Hub never
sees a card number and never touches money, which keeps it out of payment
compliance entirely.

**Paying by phone.** Every invoice GoHighLevel sends carries a **pay link**.
It opens a secure payment page that works on a phone, with no app and no
account to create. Card always works; Apple Pay and Google Pay appear where the
contractor's processor has them turned on. The homeowner can also reach the
same invoice from the Payments screen in their portal.

**Templates.** Two different things share the word:

- **The look of the invoice** — logo, business name, contact details, standing
  payment terms and days until due. Your suggestion is built (2026-09-12):
  **Invoices → Your invoice template**. A contractor sets it once and every
  invoice uses it. Any box left empty uses what their BuildSuite record has, so
  an empty template changes nothing. Before this, the letterhead came only from
  BuildSuite, which the Hub cannot edit — so a contractor had no way to change
  their own invoice logo from here at all.
- **What is on the invoice** — the stages and amounts. That is not a template
  at all: it comes from the signed contract, so every job bills exactly what
  that homeowner agreed to.

**What the homeowner sees, as of 2026-09-12.** Their payment schedule from the
signed contract — every stage, its amount, and whether it is Upcoming, Invoiced
or Paid — plus the next payment and the total still to come. Then the invoices
actually issued to them. They never see a figure the contractor is still
deciding on.

**The one thing the contractor always does by hand:** clicking *send* in
GoHighLevel. That is deliberate — your rule — so they can add a note before a
homeowner is asked for money.

---

## The short version

An invoice starts life as a line in the **payment schedule of a signed
proposal**. The Hub reads that schedule, turns each line into a draft, and the
contractor fills in whatever the proposal did not state. When they are happy,
the Hub creates a **draft invoice in GoHighLevel** — and stops. A person opens
it in GHL and clicks send.

The homeowner sees issued invoices in their portal. They never see a draft.

**The Hub never takes money.** It composes invoices and hands them to
GoHighLevel; GHL sends them and collects payment.

```
signed proposal
   │  payment schedule (3 lines)
   ▼
Hub · parse ─────────► 3 drafts, one per line
   │
   │  contractor reviews, supplies what is missing
   ▼
Hub · "Create in GoHighLevel"
   │
   ▼
GoHighLevel · DRAFT invoice ──── a person clicks send ────► homeowner
                                                               │
                                            homeowner pays via GHL
                                                               │
Hub · portal reads issued invoices ◄───────────────────────────┘
```

---

## 1 · Where the numbers come from

The source is the **payment schedule inside the signed proposal**, not something
anyone types from scratch.

It lives in one of two places, and the Hub reads both:

| Source | Coverage | Shape |
|---|---|---|
| `proposals.content` | 39 of 46 · **all 4 signed** | markdown prose |
| `proposals.sections.payment_schedule` | 8 of 46 | structured JSON |

Structured wins where it exists, because it **states** its figures where the
markdown makes us infer them from a sentence.

Three markdown shapes occur in real proposals, and all three are handled:

```
- **50%** upon acceptance of this contract and project scheduling
- Contract Signing (10%)
- **Contract Signing & Scheduling** (30% — $1,773.75)
```

Only the third gives a title, a percent **and** an amount.

### Every line becomes an invoice, not just the first

The first line is the deposit that goes out on award. Each later line becomes
its own invoice at its milestone. **The payment schedule is the invoice
timeline** — this was explicit in the brief and the code does not hardcode
"first line only".

---

## 2 · The rule that shapes everything: money is never invented

An invoice amount comes from exactly one of three places, in this order:

1. **Stated** — the proposal gave a dollar figure. Used as-is, never recomputed.
2. **Computed** — percent × contract total, rounded to cents.
3. **Unavailable** — `null`.

**Null, never zero.** A zero is a figure a contractor could send to a homeowner
by accident; blank is the honest representation of "we do not know". The draft
is still created — it just tells the contractor what it needs.

### Why this matters more than it sounds

On live data today, **every signed proposal lands on "unavailable"**:

```
proposals.total on a SIGNED proposal   0 of 4
projects.exact_budget                  0 of 103
proposals.price                        a band — "$2,000 - $5,000"
```

There is no contract total to multiply a percent by. So the deposit draft comes
out as: percent 50, no title, no amount.

**That is not a degraded path.** Chris's own rule is that the contractor catches
a blank schedule at the review step. The data means that step is where the
invoice actually gets its numbers — **the review screen is the product, not a
formality.**

---

## 3 · The contractor's side

`/dashboard/invoices` — one card per signed contract.

For each schedule line it shows:

- what the proposal said, **verbatim**, so they can check the parse
- what could not be derived, in plain language
- editable **title**, **amount** and **terms**
- a **Create in GoHighLevel** button

The contractor is not confirming a number. They are supplying it.

### What Save does

Writes their edits to `hub_invoice_drafts` in the Hub database. Re-opening the
screen never overwrites work they have already done — seeding only ever writes
the source columns.

### What Create does

Builds the invoice **from their draft, not from the parse** — by this point
their edits are the document — and posts it to GoHighLevel as a **draft**.

It then records the GHL invoice id against the draft.

**It does not send.** Nobody is emailed, nothing is charged. `sent_at` stays
null and the status stops at `ready`. Recording it as "sent" would tell a
contractor a homeowner had been invoiced when they had not.

---

## 4 · The guards, and why each exists

**One invoice per schedule line.** A second create for the same line is refused
in the action, in the database update's filter (`external_id is null`) and by a
unique index. Three layers because a double-submit races, and two live invoices
for one instalment is a homeowner asked to pay twice.

**No amount, no invoice.** Building one without an amount throws rather than
defaulting.

**No credentials, no pretending.** With GHL unconfigured the rail *refuses*. A
composed invoice that silently reaches nobody is worse than one that fails
loudly — the contractor would believe a homeowner had been invoiced. A blank
location id counts as unconfigured, since an empty one would post to whatever
the API defaults to.

**Uncertainty is not failure.** If GHL accepts the request but returns something
unreadable, or the connection drops after it lands, the invoice probably
*exists*. Reporting a plain failure would invite a retry, and the retry would
create a real second invoice. So those cases say **"this may have been created —
check GoHighLevel before trying again"** and never retry on the contractor's
behalf. A 4xx is a clean refusal, because nothing was written.

**A pending project code never prints as "null".** 53 of 103 projects have no
code yet. The reference reads `Invoice 1`, not `null · Invoice 1`.

**Contractor only.** `invoice` is contractor-only in the permission matrix and
is **not grantable** — no tick on the Team screen can widen it. Field crew and
homeowners cannot create, read, update or delete one.

---

## 5 · The homeowner's side

`/portal/payments` — their payment schedule, their invoices, and what they owe.

**The payment schedule (added 2026-09-12).** Every stage of the signed
contract, with its amount and whether it is Upcoming, Invoiced or Paid, plus
the next payment and the total still to come. Each figure comes from exactly
one of two places: the contract they signed, or an invoice actually issued to
them — never the contractor's draft. A stage is marked billed only through an
id chain (schedule line → draft → GoHighLevel invoice id), never by matching a
title or an amount. See `lib/client-payment-schedule.ts`.

Stages computed from percents close to the contract total to the cent, using
the same arithmetic as the contractor's drafts, so the two sides never show
different figures. Stated figures are never rewritten — BSA-053's proposal
states stages that sum to a cent over its total, and that is shown exactly as
signed.

Two rules govern it:

**They only ever see issued invoices.** A draft is the contractor still
deciding. Showing a homeowner a number that has not been issued is how a
conversation starts about a price nobody meant to quote.

**The contractor's own fields are dropped by construction.** `forClient`
*destructures* `contactId` and `contactName` away rather than picking fields to
keep — so a new internal field added later cannot leak by being forgotten.

Overdue is separated from outstanding, because "you owe $8,000" and "$8,000 is
late" are different conversations.

Payment itself happens **in GoHighLevel**, through the invoice the homeowner
receives. The Hub never handles a card, an account number or a payment.

---

## 6 · Why GoHighLevel and not Stripe

Chris settled this on 2026-09-01. The reasoning worth keeping:

The invoice lands where the rest of the operational record already lives, and
there is no second system holding money data. A homeowner who replies to the
invoice email lands in the conversation thread the contractor already uses.

The Hub's side is **rail-agnostic by design** — `InvoiceRail` is one interface
with one method. If the rail ever changes, one module changes and nothing else
does. But there is deliberately no environment switch between rails: a second
rail is a decision, not a configuration, and a flag would invite someone to flip
it by accident.

---

## 7 · What is NOT built

**Several named templates per account.** One template per account today. A
choice of templates at invoice time needs a decision about which is the
default; the table can grow a `name` column without changing what it holds.

**No automatic trigger.** Chris's flow begins *"signed contract comes back → a
draft invoice is created automatically"*. Nothing watches for a signature today.
A draft appears because a contractor opened the screen.

**No send from the Hub.** By design — the send stays a human step in GHL so the
contractor can add a note first. This is Chris's rule, not a limitation.

**No follow-on email.** Step 5 of his flow — the message that schedules the
project, requests documents and passes the project ID to the homeowner — does
not exist.

**No payment status sync.** The Hub reads invoices from GHL, so paid/unpaid
reflects what GHL says. Nothing writes back.

---

## 8 · Where it actually stops today

**No invoice has ever been created from this screen.** Not once, by anyone.

The chain breaks before the code gets a chance:

```
4 signed proposals
   └── all point at project 87a42c43
         └── that project returns 0 rows — it is gone from the table
               └── no readable signed project
                     └── nothing to invoice against
```

Plus `supabase/hub/0008_invoice_rail.sql` has not been run, so the Create button
will error until it is.

**So the invoice flow is code-complete and unexercised.** The guards are tested,
the rail was proven live from the other branch (a real GHL draft, `000195`), and
the two have never met on a real job.

What it needs is not more code. It needs **a signed project we can read** and
**a real contract amount on it** — both asked for in
`docs/asks/sing-buildsuite-blockers-2026-09-08.md`.

---

## Where the code lives

| Concern | File |
|---|---|
| Parsing both schedule sources | `lib/payment-schedule.ts` |
| Turning a line into a draft | `lib/payment-schedule.ts` · `draftInvoiceFor` |
| Storing the contractor's edits | `lib/hub-db/invoice-drafts.ts` |
| Which rail, and building the invoice | `lib/invoicing/rail.ts` |
| The GoHighLevel client | `lib/invoicing/ghl-rail.ts` |
| Reading invoices back for the portal | `lib/ghl/invoices.ts` |
| Contractor screen | `app/dashboard/invoices/page.tsx` |
| Homeowner screen | `app/portal/payments/page.tsx` |
| Tables | `supabase/hub/0007_invoice_drafts.sql`, `0008_invoice_rail.sql` |
