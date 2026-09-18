# Role-by-role rehearsal — steps and checklist

**For:** whoever runs the rehearsal on the live Hub
(https://project-hub-one-vert.vercel.app). Written 2026-09-18.

Every step here happens in **production**, on live data. Work through one test
project from top to bottom; each role's section says what to click and what
counts as a pass. Tick as you go and note the reference number from any error
screen — it is how the log entry is found.

> ## ⚠️ READ FIRST
>
> **1 · Use a test project, never a real homeowner's job.** Sections 2–5 send
> emails, open accounts and write to the live database. Anything you do on a
> real project is real for that homeowner.
>
> **2 · One browser holds one sign-in.** Signing in as the crew or the
> homeowner replaces your contractor sign-in, and a contractor page left open
> in another tab stops saving. Give each role its own **private window**.
>
> **3 · Two things must happen before any real payment is taken:**
> the owner connects a payment gateway in GoHighLevel, and **the exposed APS
> token is rotated**. Rotate it before the rehearsal if it has been shared
> anywhere — a Private Integration token gives full API access to that
> sub-account. Put the new one only in Vercel's environment variables; never in
> the repo, a message, or a screenshot.
>
> **4 · Emails only go out if `GHL_SEND_EMAIL=true` on Vercel.** If it is off,
> invitations and appointment emails are not sent — the screen hands you the
> link instead, and says so. Decide which you want before you start.

## What you need before you start

| | |
|---|---|
| A test project | Stage **awarded**, with a **signed** proposal — the Hub lists nothing else. It must have a project code (e.g. `BSA-0xx`) and a client email you control. |
| A crew mailbox | An address you can open, for the invitation. Not a real crew member's, for a rehearsal. |
| A homeowner mailbox | Must match `client_email` on the test project; that address plus the project code is the homeowner's sign-in. |
| Two private windows | One for the crew, one for the homeowner. |
| Your own sign-in | Open Project Hub from the BuildSuite menu in GoHighLevel. There is no contractor password. |

---

## 1 · Contractor — the project is real and complete

Sign in from the BuildSuite menu in GoHighLevel.

- [ ] **The project is listed.** Projects → the test project appears under
      **Awarded**. If it is missing, check its stage is `awarded` and its
      proposal is signed or won.
- [ ] **The code, not an id.** The row shows a project code (`BSA-…`), never a
      long string of letters and numbers. Same on every screen you open.
- [ ] **Signed contract.** The Projects row shows **Signed** with a PDF link,
      and the project's **Documents** page lists "Signed contract" at the top,
      marked contractor-only. Open it — it should be the signed contract.
      *(This link is public to anyone holding it: do not forward it.)*
- [ ] **Overview** names the client, address, code, current and next milestone.
- [ ] **Timeline** — add a milestone, set its status, mark it visible to the
      client. It saves and stays after a refresh. *(writes)*
- [ ] **Schedule** — add an appointment, tag a crew member or the homeowner in
      **Trade or crew**. Expect "Saved. Emailed to you and …", or a line saying
      email sending is off. *(writes, may send email)*
- [ ] **Tasks** — assign a task to your test crew member with a note and a
      date. It should show **Not opened yet**. *(writes)*
- [ ] **People** — the homeowner's email and their project code (their
      password) are shown, and the crew member is listed.
- [ ] **Budget / Payments** — the contract amount matches the signed proposal,
      and the payment schedule stages add up to the total. *(The generator is
      known to round: stages summing to $7,591.11 against a $7,591.10 total.)*
- [ ] **Invoices** — create an invoice draft and send it to GoHighLevel. It
      opens in the GoHighLevel invoice editor. *(writes, creates a real
      invoice — do not send it to a homeowner unless you mean to)*
- [ ] **Photos & Videos** — every photo on the project is here, whoever added
      it: the crew's from a task or an update, and yours. Each shows the
      picture itself, who added it and whether the client can see it.
- [ ] **Visibility** — note which switches are on: Client Portal, Budget,
      Detailed Pricing, Schedule, Assigned Team, Documents, Photos, Daily
      Updates, Change Orders, messaging, issue submission, file uploads. You
      will check the client side against exactly these.

## 2 · Field crew — they see only what is theirs

- [ ] **Invite them.** Project → People → invite the crew mailbox. The screen
      shows the link whether or not the email went. *(writes, may send email)*
- [ ] **In a private window**, open the link, set a password, and land on the
      field view.
- [ ] **Only assigned projects.** Their Today and Tasks screens show only the
      test project. No other job, anywhere in the app.
- [ ] **No money.** Nowhere in the field view: contract amounts, pricing,
      margin, or client payment details.
- [ ] **Task update.** Tasks → open the task → it shows your note under "From
      your PM" → set the status (e.g. In Progress) → Save. *(writes)*
- [ ] **Update with a photo.** On the task, "Send an update": what they did,
      **Take photo** on a phone, then "Send update to PM". Expect "Update sent
      to your PM with 1 photo". *(writes, uploads)*
- [ ] **Daily update.** Update tab → fill it in, add a photo, add a blocker,
      submit. *(writes)*
- [ ] **A note to the PM.** Messages → send one. It is internal: the homeowner
      must never see it. *(writes)*
- [ ] **The badge clears.** Opening the task removes its "new" dot.

## 3 · PM — the submissions arrive and can be reviewed

Back in your contractor window (reopen from GoHighLevel if it was replaced).

- [ ] **Field Updates** lists both submissions, marked **Pending**, with the
      count of those awaiting review. **No notification is sent** — nothing
      emails or pings the PM, so the queue is the only signal today.
- [ ] Each shows what the crew wrote, their internal notes, and their suggested
      client summary — the crew's suggestion is saved but not published.
- [ ] **Return for Revision** on one: it goes back to the crew. *(writes)*
- [ ] **Approve Internally** on one: kept off the client portal. *(writes)*
- [ ] **Approve and Publish** the last one, after editing the client summary in
      your own words. *(writes — this is what a homeowner will read)*
- [ ] **The blocker** appears on the update itself. **It does not create an
      Issue** — the field form says "raises an issue for your PM", but that
      step only writes a line to the server log today. Expect nothing new on
      the Issues page, and treat the wording as a gap to fix, not a failure.
- [ ] **The photo** is under the project's Photos, shown as a picture,
      internal, captioned "Task: …" if it came from a task. Release the ones
      worth showing with the switch on the row.
- [ ] **The task status** the crew set shows on the project's Tasks page, with
      **Seen**.
- [ ] **The crew's message** is in the project's Messages, internal.

## 4 · Client — only their project, only what you released

- [ ] **In a second private window**, open the site root and sign in with the
      homeowner's email and the **project code** as the password.
- [ ] **Only their project.** No other job is reachable, by any link.
- [ ] **What they see matches your switches** from §1: sections you turned off
      are absent, not merely empty.
- [ ] **The published update** appears, in your words, not the crew's.
- [ ] **The internally-approved update does NOT appear.**
- [ ] **No internal information anywhere:** no original estimate, markup,
      margin, internal priority, delay reason, internal notes, no crew
      messages, no supplier or labour costs.
- [ ] **Their own code.** Anything the homeowner sees carries the project code
      (e.g. `BSA-053`), never the contractor's award code.
- [ ] **Payments** shows the schedule and any invoice you released, with no
      internal pricing breakdown.
- [ ] **They can ask.** Send a message as the homeowner and confirm it arrives
      on your side. Approving a selection or a change order also works. *(writes)*
- [ ] **Photos:** the released ones appear as pictures they can open; the
      internal ones are not listed, and their links do not work even if
      someone has one.
- [ ] **Documents:** a released document downloads. *(This was a dead button
      until 2026-09-18.)*

## 5 · Demo — refresh the screenshots

- [ ] Retake the contractor, field and client screenshots from the verified
      test project above.
- [ ] Check no screenshot shows: a raw project id, an internal cost, a crew
      member's email address, or the signed-contract link.
- [ ] Keep one screenshot per role, dated, so the deck matches what the product
      does today.

---

## Not built yet — do not log these as failures

| Where | What |
|---|---|
| Portal → Issues | **"Raise an issue"** is a button with nothing behind it. A homeowner cannot raise one yet; the switch only shows the button. |
| Portal → Documents | **"Upload File"** likewise, and the underlying switch is hardcoded off, so a homeowner cannot upload anything. |
| Portal → Schedule, Dashboard | A few buttons are still placeholders. |
| Daily update → blocker | Records the blocker, but does not open an Issue. |
| Field update submitted | Nothing notifies the PM; the review queue is the only signal. |

## Before real payments

| | Owner | Why |
|---|---|---|
| **Connect a payment gateway** | The account owner, in GoHighLevel | Invoices can be created and sent now, but nothing can be paid until a gateway is connected. |
| **Rotate the exposed APS token** | Whoever holds the GoHighLevel account | A Private Integration token is full API access to that sub-account. Rotate, then put the new value in Vercel (`GHL_LOCATION_TOKENS`, as `locationId:token`) — never in the repo or a message. |

## If a screen fails

- The error page shows a **reference number**. Note it; it matches a line in
  the Vercel log and is the fastest way to the cause.
- "This browser is signed in as someone else" means the sign-in was replaced by
  another role in the same browser — not a fault in the page. Use private
  windows.
- "Not connected to BuildSuite" or "the Hub database is not connected" is an
  environment problem, not a data problem. Note which page and carry on.
