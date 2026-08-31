# Sprint plan — make it usable by real contractors

**Written:** 2026-08-31 · **Length:** 5 days · **Owner:** Dale
**Goal:** a contractor can run a signed job in this system: edit it, update it,
archive it, and give their crew and their homeowner controlled access to it.

---

## 0. A correction that changes the premise

I have been reporting **"no deal has ever been signed — 0 of 182."** That was
measured against `deals.signature_signed_at`, and it is the wrong column.

**Signature lives on `proposals`.** Measured today:

| | |
|---|---|
| `proposals` rows | 46 |
| status `draft` / `submitted` / `accepted` | 27 / 15 / **4** |
| `signature_status = 'SIGNED'` | **4** |
| with `signed_pdf_url` | **4** |
| with `adobe_agreement_id` | **4** |
| with a real `contractor_id` | **17** |

**Four proposals were genuinely signed in February 2026**, with Adobe agreement
ids and signed PDFs. They are all for one project, so the honest statement is
*one job has been signed, once* — not *nothing has ever been signed*.

It also confirms what you said about Sing's matching. The match is not
`deals.matched_contractor_id` (5 rows). It is **`proposals.contractor_id`**, and
that is populated on 34 of 46. The pipeline I built reads the wrong table for
this purpose.

**So the premise of this sprint is sound:** there is real matched, proposed and
signed work in the database, and it is reachable. Everything below is corrected
to read `proposals`, not `deals`.

---

## 1. What "usable by real contractors" means here

Your three asks, translated into what the system must actually do.

### A · The book of work is signed work, not leads

Today the contractor sees every project on the account and a funnel of 182
mostly-test enquiries. That is a sales screen, and it is not what a project
manager opens.

**After:** the default screen is **active engagements** — projects that have a
submitted or accepted proposal with a real contractor attached. Leads with no
proposal are not deleted or hidden from the system; they simply stop being the
front page. There is a filter to see them if anyone wants to.

### B · Records can be edited, updated and archived

Today every contractor screen is read-only in practice. The permission matrix
already says a contractor has full CRUD — nothing exercises it.

**After:** create, edit and archive forms on every operational record a
contractor owns, each one going through `assertCan` before it writes.

**Archive, never delete.** Records get `archived_at` and disappear from the
default view; nothing is destroyed. Two reasons: the approval trail is what the
whole privacy model rests on, and BuildSuite already uses a `deleted_at`
soft-delete convention that we should match rather than fight.

### C · The contractor invites their crew and their homeowner

Today there is no way to add a user. Field and client sessions exist only because
we mint them by hand.

**After:** the contractor opens **Team**, enters an email, picks a role, ticks
what that person may see, and sends an invitation. The invitee sets their own
password on a single-use link and lands in the right experience.

**Per-user permission ticks on top of the role**, not instead of it. The role is
the ceiling and the ticks can only narrow it — a field user can never be ticked
into seeing margins, because the role forbids it and the matrix is closed by
default. That distinction is what stops the tick boxes becoming a way to
accidentally grant something dangerous.

---

## 2. The blocker, stated first

**Everything in this sprint writes, and the Hub has nowhere to write.**

`0001_hub_tables.sql` — nine tables, create-only — has never been run. There is
no store for a field update, a milestone, a document, an archived record, a user
invitation, or a permission grant.

The guardrail is absolute and I am not proposing to bend it: **we never alter a
BuildSuite table.** Every Hub write goes to Hub-owned tables.

**Three ways forward. Pick one before day 1 ends.**

| | What it means | Cost |
|---|---|---|
| **A — Sing runs `0001` + a new `0002`** | Hub tables live beside BuildSuite's in the same database. Simplest join story. | One task for Sing, needs the service-role key |
| **B — a separate Supabase project for the Hub** | We own it entirely. Zero risk to BuildSuite prod, and no permission needed from anyone. Cross-database joins become application-level, which they already are. | ~2 hours to stand up; a second connection string |
| **C — build against a local Postgres and switch later** | Unblocks today, proves nothing about production. | Cheap, but the switch is real work later |

**My recommendation: B.** It removes the "do not touch production" tension
permanently, it needs nobody's approval, the Hub's records were always supposed
to be ours, and it turns a blocking dependency into a configuration value. A is
better if Sing wants one database, and that is a fair preference — but it means
this sprint starts when he is free rather than when we are.

**One more finding you should know:** the single genuinely signed project is
**not readable with our current key** — RLS hides it. So even option A does not
give us that project without Sing widening the policy or issuing a key that can
see it. That is a fourth item for his list either way.

---

## 2b. Day 1 found something that changes the tenancy model

**Scoping engagements by `projects.auth_profile_id` returns nothing.** Measured
2026-08-31 against the live database:

- 19 live proposals across **7 projects**
- **0 of those projects belong to the Alliance profiles we have been demoing as**
- 4 of the 7 have `auth_profile_id` **null**, so no tenant scope can ever see them
- the 7th is the signed one, and BuildSuite's RLS hides it from our key entirely

**The correct key is the contractor, not the project owner.** A contractor's book
of work is `proposals.contractor_id = their contractor`. Following that:

| Contractor | Live proposals | Signed |
|---|---|---|
| `5dd312bd` — **AFC, ralph@alliance4contractors.com** | 5 | **4** |
| `7e70d472` | 4 | 0 |
| `ff4a29d8` | 2 | 0 |

Three contractors have a real book of work. 8 of 19 live proposals have no
contractor attached at all.

**The link from a signed-in user to their contractor row is
`auth_profiles.contractor_id`** — and it is populated on **1 of 110 profiles**.
That one is `7726102a` → `5dd312bd`, which is Ralph, and it is the profile that
owns the only signed job.

**Two consequences for this sprint:**

1. **Tenancy for engagements resolves through the contractor**, not the project.
   `session → auth_profile → contractor_id → proposals.contractor_id`. The
   existing project-based scope stays for everything else.
2. **`auth_profiles.contractor_id` needs backfilling** — one row of 110. Email
   matches 52 of 483 contractors to a profile, so a backfill is feasible, but it
   is a write to a BuildSuite table and therefore **Sing's, not ours**. Until it
   happens, only Ralph can see a book of work.

**A correction I owe:** I previously removed profile `7726102a` from
`mint-cookies.mjs` describing it as "the fixtures' invented profile". It is not
invented. It is a real admin profile, it is the only one linked to a contractor,
and it owns the only signed work in the database.

---

## 3. The sprint

### Day 1 · The engagement model, and the decision

| | h |
|---|---|
| Read `proposals` — tenant-scoped, narrow columns, same discipline as the deals reader | 2.0 |
| `Engagement` = project + its live proposal + contractor + signature state. One type the whole app agrees on | 2.0 |
| `/dashboard` becomes the engagement list; the deal funnel moves behind a "Leads" tab | 2.0 |
| Tests: what counts as active, what counts as signed, an empty tenant | 1.5 |

**Ships:** the contractor opens the app and sees jobs, not enquiries.

**Also today:** the store decision above gets made, because day 2 cannot start
without it.

---

### Day 2 · Writes, and the archive

| | h |
|---|---|
| `0002_hub_records.sql` — `hub_record_edits`, `hub_archive`, `hub_activity` — create-only, RLS deny-by-default | 1.5 |
| The write path: every mutation goes through `assertCan`, then a Hub table, never BuildSuite | 2.0 |
| Edit forms — project details, milestones, tasks, notes | 2.5 |
| Archive + restore, with `archived_at` and an activity entry naming who and when | 1.5 |

**Ships:** a contractor can change something and it stays changed.

**The rule that governs this day:** the Hub never writes to BuildSuite. Where a
field originates in BuildSuite, the Hub stores an *override* and shows the
override with a marker saying it was edited here. That keeps the boundary honest
and means BuildSuite can keep changing underneath us without a fight.

---

### Day 3 · Users and invitations

| | h |
|---|---|
| `0003_hub_users.sql` — `hub_memberships`, `hub_invitations`, `hub_grants` | 1.5 |
| Invitation flow: contractor enters email + role → single-use token, expiring, one row | 2.0 |
| `/verify` already exists and mints sessions — extend it to accept an invitation and set a password | 2.0 |
| The **Team** screen: who has access, what they can see, revoke | 2.0 |

**Ships:** the contractor adds their superintendent without anyone touching code.

**Note on identity:** `auth_profiles` already has `user_type` — 64 contractor, 14
client, 4 admin. **There is no `field` type.** Rather than add a value to a
BuildSuite table, Hub memberships carry the field role, and we map to
`auth_profiles` where one exists. The Hub owns its own membership list.

---

### Day 4 · Role management that cannot betray you

| | h |
|---|---|
| Extend the matrix: per-user grants that can only **narrow** the role, never widen it | 2.0 |
| The tick UI — grouped by what a person would recognise, not by resource name | 2.0 |
| Guardrail tests: no grant can raise a field user above the field ceiling; a revoked user loses access immediately | 2.0 |
| Every mutating action re-checked through the extended path | 1.0 |

**Ships:** the ticks do what they look like they do, and cannot do more.

**The invariant:** effective permission = role matrix **AND** grant. Never OR.
An OR would let a tick box grant something the role forbids, and that is exactly
how a homeowner ends up seeing a margin.

---

### Day 5 · Make it real, then prove it

| | h |
|---|---|
| Run the whole thing against a real engagement end to end | 2.0 |
| Fix what that breaks | 2.0 |
| Seed the demo path so the walkthrough has a live signed job again | 1.5 |
| EOD, and update `SYSTEM-STATE.md` with what is now true | 1.0 |

**Ships:** a contractor could be handed this on Monday.

---

## 4. How it behaves after the sprint

**The contractor** opens the Hub and sees their **active engagements** — jobs
with a real proposal and a real contractor, not 182 enquiries. They can open one,
edit the details that are wrong, add a milestone, archive a job that died, and
see an activity trail of who changed what. They open **Team**, invite their
superintendent as Field with photos and tasks ticked but budget not, invite the
homeowner as Client with updates and documents ticked, and revoke either in one
click.

**The field crew** get an email, set a password, and land in the field interface
scoped to the jobs they were given — never GoHighLevel, never money.

**The homeowner** gets an email, sets a password, and sees exactly what was
ticked, filtered through the §9.1 gate that already exists.

**What still will not work:** anything that needs GoHighLevel operational
records, because the object key is still missing. Payments, because the rail is
undecided. And the signed project stays invisible until its RLS policy lets our
key see it.

---

## 5. What I need from you

1. **The store decision — A, B or C in §2.** Nothing after day 1 can start
   without it, and B needs nobody but us.
2. **Confirm archive-not-delete is right.** I am assuming a contractor never
   truly deletes; if they need hard delete for a genuine mistake, say so now
   because it changes the schema.
3. **Who sends the invitation emails?** GoHighLevel can, or we add a mail
   provider. GHL is fewer moving parts and it is already in the stack.

And one thing I will do regardless: correct the "0 signed" claim everywhere it
appears — the EODs, `SYSTEM-STATE.md`, the asks, and the HUD — because I have
been repeating it for three days and it is wrong.
