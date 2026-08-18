# Where the Project Hub Actually Is

**From:** Dale
**Date:** 2026-08-14
**Live:** https://project-hub-one-vert.vercel.app

---

## First, the fair criticism

You looked at our system next to the portal demo and said ours looked backward.
You were right about what you saw. The demo has twelve screens a homeowner can
click through. Ours has one.

That's not a misunderstanding to be corrected. It's a real gap, and I own the
decision that produced it.

What I want to do here is explain what we built instead, why it isn't optional,
and how quickly the visible part closes — because it closes fast.

---

## What we built first, and why

Every contractor project has two kinds of information sitting side by side:

**What the homeowner should see** — progress, schedule, what's next, what they
owe.

**What they must never see** — what you paid your supplier, what you marked it
up, your margin, and the crew's unfiltered notes about the job.

Those live inches apart in the same record. On the same screen. Often in the same
sentence.

We built the system that keeps them apart before we built the screens that
display them. Concretely, four things:

**1. A homeowner can only ever see their own project.** Not the neighbour's, not
another contractor's. We check this at the point the data is fetched, not by
hiding things on the page — because anything hidden on a page can be found by
anyone curious enough to look.

**2. Your costs and margins cannot reach a client's screen.** Not "we remembered
to hide them" — the client view is assembled from a list of what's *allowed out*.
Anything new is private until someone deliberately shares it. There are automated
tests that fail the moment a cost figure appears where it shouldn't.

**3. Nothing from the field reaches a homeowner unreviewed.** A crew member writes
their honest notes; the project manager sees those, edits a clean summary, and
publishes. There is no path — none — from a field note straight to a client. We
tested that by exhaustively checking every possible sequence of actions.

**4. Each contractor's data is separated from every other contractor's.** One
system, many companies, and no way for one to see another.

---

## Why that mattered enough to go first

Because each of those, done wrong once, ends a contractor's relationship with a
customer — and probably with you.

A homeowner who sees your cost and your price on the same screen doesn't call to
discuss it. A homeowner who reads a crew note saying the wrong worktop was ordered
doesn't forget it. A contractor who finds another company's projects in their
dashboard doesn't stay.

These aren't hypothetical. **We found one for real.** Reading live data, one query
returned 43 active projects belonging to five different contractors — all visible
to whoever was signed in. We caught it and fixed it. On a system that had shipped
the pretty screens first, that same query would have been quietly powering a
dashboard for weeks.

You cannot add these afterwards. They shape how every screen fetches its data, so
retrofitting them means rewriting the screens you already paid for.

---

## What this cost us, honestly

It cost us the meeting.

I built inward-out — foundation first, surface last. That's the right order
technically and the wrong order for anyone judging progress by looking at it. You
had no way to see two weeks of work, because the work was invisible by nature.

That's my error, not yours. I should have kept a visible screen moving alongside
the foundation so you could see progress in the only way progress reads: on a
screen.

---

## What exists right now

The system is deployed and you can open it today.

- **All three experiences are built** — contractor dashboard, field interface for
  crews, and the client portal
- **Real production data** — the contractor dashboard reads live projects from
  BuildSuite's database, not samples
- **Real sign-in**, with tamper-proof sessions
- **The complete approval loop works end to end** — crew submits, manager reviews
  and edits, manager publishes, client sees only what was approved
- **Contractors see only their own projects** — sign in as two different
  contractors and the data is completely separate
- **The workflows are built** — project creation from a signed proposal, stage
  syncing, field-update review and publishing, issue handling, project completion

Two things worth doing when you open it, in this order. They take three minutes
and they show the parts a demo can't:

**Sign in as two different contractors.** Completely different projects, no
overlap. That's one system serving many companies without them ever meeting.

**Follow an update through.** Sign in as the crew member, write a daily update
with a private note. Sign in as the manager — the private note is flagged in red,
the client summary is editable. Publish it. Sign in as the homeowner: the update
is there, showing only what the manager approved. The private note isn't hidden
from her. It was never sent.

---

## The plan, with a date

The demo is the right target. We're building to it.

| | What | When |
|---|---|---|
| **This week** | Every screen from the demo exists — timeline, schedule, updates with photos, documents, photos, messages | ~2 days |
| **Then** | The approval screens — material selections, change orders, issues, detailed budget | ~2 days |
| **Then** | Closeout, punch list, warranty | ~1 day |

**Roughly a week to full parity with what you saw**, and each of those screens
arrives with the protections above already applied — because the foundation
they're built on is finished.

Most of them are a day or two each precisely *because* of the two weeks that
didn't look like anything. The data model behind every one of those screens
already exists; it was designed from the same specification the demo was.

---

## Three things I need from you

**1. Is the demo the specification now?** It's a better client experience than our
original document describes. I'd rather build to it deliberately than discover it
one screen at a time — which is what happened, and it's on me for not asking
sooner.

**2. Two of its screens contradict our original plan.** It shows documents and
invoice payment inside the portal; our plan routes both through GoHighLevel's
built-in system. In-app is a better experience and a bigger build — handling card
payments ourselves brings compliance obligations we deliberately avoided. Worth
ten minutes of your time to decide.

**3. The demo shows six project stages; our pipeline has nineteen.** Contractors
need that detail, homeowners don't. Someone who runs projects should tell us how
the nineteen collapse into the six a client sees.

---

## The short version

You saw a gap and named it. It was real, and I own how it came about.

What sits behind our system is the part that can't be added later — and we found a
live data leak proving exactly why. What sits in front of it is about a week's
work, and it's work that goes quickly because of what's already there.

Open the link. Sign in as two contractors. Then judge it — and if it's still not
where you need it, tell me and I'll keep going until it is.
