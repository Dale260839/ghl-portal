# Decisions needed from Chris

**Prepared:** 2026-08-12 · **For:** huddle
**Deadline context:** 7 working days to 2026-08-21

Everything currently waiting on a decision, ranked by what it's costing. Each has
a recommendation — none of these need to be an open discussion unless you
disagree.

---

## If we only settle three things

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| **1** | Where the hub lives — its web address | Subdomain of BuildSuite now, per-contractor later | **Deploying and testing login. Blocking today.** |
| **2** | The shared ID between BuildSuite and GHL | Use the one that already exists | Roughly a morning of rework, growing the longer we build on it |
| **3** | GHL access for multiple sub-accounts | A GHL Marketplace app, before the second client | Onboarding becomes manual admin forever if we don't |

Everything below the line is real but can wait a few days.

---

## 1. Where does the project hub live? — blocking today

We're ready to deploy and test the login flow and can't, because we don't know the
address.

| Option | Cost | Trade-off |
|---|---|---|
| **A · Subdomain of BuildSuite** (`projects.buildsuite.ai`) | Free, today | Hub's identity is tied to BuildSuite's domain |
| **B · Its own domain** | A registration, ~a day of DNS | Cleanest if the hub is ever sold or presented as its own product |
| **C · A subdomain per contractor** (`projects.<theirdomain>`) | Most work | What the architecture originally specified. Best white-label. |

**Recommendation: A to launch, plan for C.** It gets us deployed this week at no
cost, and the login mechanism works identically on any domain — so moving later
is a migration, not a rebuild.

**Worth saying now if C is the eventual goal**, because it changes how we set up
hosting, and that's cheap to get right up front and annoying to retrofit.

**Also needed:** someone who can add a DNS record on whichever domain wins.

---

## 2. The shared ID — we specified one that doesn't exist

The architecture makes `BSP-YYYY-NNNNNN` the master key across BuildSuite, GHL and
Supabase (§5, §3.6). **It isn't there.** BuildSuite's project table has 53 columns
and none of them is a BuildSuite Project ID — verified directly against the live
database.

What *is* on every row: `ghl_contact_id` and `ghl_opportunity_id`. **BuildSuite
already links to GHL, using GHL's own identifiers.**

| Option | Cost |
|---|---|
| **A · Adopt `ghl_opportunity_id`** ✅ | Amend §5/§3.6. About a morning of rework on our side. |
| **B · Sing adds a `BSP-` column and backfills** | A production schema change on BuildSuite's database, to introduce a key that duplicates a working one. |

**Recommendation: A.** §5's actual requirement is *one immutable shared key, never
match on name or address*. `ghl_opportunity_id` satisfies that. The `BSP-` format
was a preference, and it isn't worth a production migration to preserve.

**Cost of waiting:** our code currently *rejects* anything that isn't `BSP-`, so
every day we build on it, the rework grows.

---

## 3. GHL access across many sub-accounts

The hub serves premium clients who each have their own sub-account. Two ways to
get GHL access for each:

| Option | Reality |
|---|---|
| **A · A private integration key per sub-account** | Someone creates one by hand for every new contractor, and we store a growing pile of long-lived secrets. Fine for two or three clients; unpleasant at twenty. |
| **B · A GHL Marketplace app with OAuth** ✅ | Built once against the agency. New sub-accounts need **no manual work** — a click, or nothing at all with an agency-level install. Tokens rotate automatically. |

**Recommendation: B, before the second client.** We can keep the current key for
the build sub-account while developing. But hand-managing secrets is something you
only escape by deciding not to start.

**What B needs from you:** create a private (unlisted) app at
`marketplace.gohighlevel.com`, distribution type Agency + Sub-account, then send
the Client ID and Secret. Perhaps an hour. I've written the full step-by-step
separately.

**One knock-on:** OAuth tokens have to be stored somewhere writable, and the hub
doesn't own a database yet — BuildSuite's is read-only by rule. We'd need a small
one of our own. Minor cost, but it's the first infrastructure the hub owns rather
than borrows.

---

## 4. Three things the architecture asks for but never defines

All three are in the workflows now with provisional values, clearly marked. Each is
a one-line change once confirmed — but they're currently my guesses sitting in
your product.

| | Question | Currently |
|---|---|---|
| **W1** | What progress percentage does each pipeline stage mean? | A straight line between the only two figures the architecture states — 10% at creation, 100% at completion |
| **W2** | What milestones and tasks should a new project start with? | Seven generic milestones, two tasks. Kept thin: a wrong default on every project is noise a PM clears by hand |
| **W3** | Which stage changes should notify the client? | Six stages, biased toward silence. Over-notifying gets a portal muted, and then the notifications that matter get missed too |

**These want ten minutes with someone who runs projects**, not an architecture
discussion.

---

## 5. Pipeline stage count — before anyone builds the pipeline

The architecture lists **19** sequential stages. The kickoff PDF says **20**. We've
built to 19, since the architecture wins on conflicts.

Cheap to confirm now, irritating to discover after the pipeline exists in GHL and
projects are sitting in it.

---

## 6. How do homeowners sign in?

Contractors and field staff are solved — they're already in GHL, so they land in
the hub already signed in.

**Homeowners aren't.** They don't have GHL logins; they use GHL's native Client
Portal. So the client side needs its own answer, and it shouldn't be assumed to
work the same way.

Not blocking this week, but it is the last unknown in the client portal, and it's
better answered before we wire that screen than after.

---

## 7. Phase 0 has never been run

The two validation tests that were meant to gate everything haven't reported back.
The runbook is in the repo and takes about an hour.

They matter less than they did — we've since learned by reading the live systems
what the tests were meant to reveal. But one open question remains: **can GHL
records be filtered by contact in a single call?** That decides whether the client
portal does one query or many, which is a performance question at scale.

---

## For information — two things that changed

Not decisions, but you should hear them from us rather than notice them later.

**The snapshot is a smaller multiplier than planned.** Because the front-end and
the workflows are now code rather than GHL configuration, the Phase 6 snapshot
carries objects, fields, pipeline, forms, templates and portal settings — but not
the app. The app is one deployment serving every sub-account, which is *better*
operationally, but "build once, snapshot everywhere" was part of the original
justification and it's honest to say it's narrower now.

**A security note for Sing's side.** BuildSuite's public web key can read the
contractors table, including names and phone numbers. Publishable keys are meant
to be embedded in browsers, so that data is effectively public today. We're not
using it and won't touch it — but it's much cheaper to fix before someone notices.

---

## Timeline, honestly

Seven working days to 21 August. The screens are built — all three experiences —
and the BuildSuite half is already reading live production data. What's left is
almost entirely connection, and connection is where every blocker above sits.

**If the domain and GHL access land in the next two days**, the full chain is
demoable: signed proposal → project appears → stage moves → client sees progress.

**If they slip past mid next week**, the honest call is demoing with the BuildSuite
half live and the GHL half on sample data. Still a real demo of the product — just
not the full loop — and better decided in advance than discovered on the day.
