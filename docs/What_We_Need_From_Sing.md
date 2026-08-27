# What we need — Sing and Pat

**Updated 2026-08-26.** The database ask is unchanged from what you last saw — nine tables. It
was briefly cut to three earlier today on a misreading of the source documents, and reverted.
Two genuine improvements came out of that: a `hub_visibility_settings` table that was missing,
and a tenancy key that two tables lacked.

---

## The short version

| # | Who | What | Effort |
|---|---|---|---|
| 1 | **Chris + Pat** | Confirm the Alliance sub-account tier supports **Custom Objects** | ~10 min |
| 2 | **Pat** | Run the two go/no-go tests | ~10 min + ~1 hr |
| 3 | **Pat** | The three wires: integration token · object key · **webhook secret** | — |
| 4 | **Sing** | Run `0001_hub_tables.sql` — nine tables, create-only | ~5 min |
| 5 | **Sing** | Send-to-CRM extension stamping project identity | ~1 day (your estimate) |
| 6 | **Sing** | The client-to-contractor matching | — |
| 7 | **Chris** | Four decisions, listed at the bottom | — |

---

## 1 · The gate — Custom Objects on the Alliance tier

**Chris + Pat, and it outranks everything else on this page.**

Both your review (§5) and the Aug 21 huddle (§7) name this as the gate, and we have been
building past it. Every one of the four documents assumes GoHighLevel owns the operational
records after handoff — milestones, tasks, updates, selections, change orders. That model
requires Custom Objects on the sub-account tier, **not just at agency view**.

If the answer is no, the ownership model changes and several decisions reopen. Ten minutes to
check now beats finding out in week three.

---

## 2 · The two go/no-go tests

Straight from your review §5 and the build strategy §3. Neither has been run.

**Test A — snapshot transfer (~10 min).** One custom object, a few fields, one association to
Contact. Push it through a snapshot into a test sub-account. Confirm the object, the fields and
the associations all arrive, and that a workflow can reference it.

*Why:* the entire per-contractor rollout rides on snapshots carrying custom objects. If they do
not, we need a per-account setup script and we want to know on day one.

**Test B — one live field (~1 hr).** Wire one real field — progress percentage is the suggested
one — from a live custom object record into a screen, change it, see it change.

*Why:* it is the only piece nobody has tested. Worth saying precisely what we have already
done, so you can scope what is left: **the Hub reads BuildSuite's live Supabase today** and
renders 27 real projects for the Alliance tenant. So the "can a real record reach a screen"
half is proven. **What is untested is the GHL custom object read** — which is the half Test B
is actually about, and it needs the object key from item 3.

---

## 3 · The three wires — Pat

From the Aug 21 huddle §7. We have env slots for all three; none are populated.

| Wire | What it does | Status |
|---|---|---|
| **Integration token** | Lets the Hub talk to the GHL account | Have one for Alliance, scoped to one sub-account |
| **Object key** | Tells the Hub which record type to read/write | **Missing** — this is what blocks reading GHL at all |
| **Webhook secret** | Lets GHL notify the Hub when something changes | **Missing** |

The webhook secret is the one most easily overlooked, and the huddle put it plainly: *"custom
values alone do not trigger anything."* Without it nothing fires, and we will not accept an
unverified webhook — an endpoint that trusts an unsigned payload is an endpoint anyone can post
to.

Once the object key exists, wiring the Hub is roughly an afternoon of config, not a build.

---

## 4 · Run the migration — Sing

**`supabase/migrations/0001_hub_tables.sql` — nine tables, create-only.**

GoHighLevel is the operational system of record after handoff; that is not in dispute. But GHL
custom objects are not reachable yet — no object key, and the sub-account tier is unconfirmed —
so these tables are the Hub's working store until they are, and the migration source when they
are. That was the original reasoning (D-014) and it stands.

Since you last saw this, two corrections:

- **Added `hub_visibility_settings`.** The per-project client-visibility switches had no home.
  The app enforces them, so the app should store them.
- **Added `auth_profile_id` to `hub_update_acknowledgements` and `hub_update_comments`.** Both
  carried `project_id` only, so their tenant was reachable only by joining `hub_daily_updates`.
  The migration's own rule says every table carries both keys; these two did not.

**What it does to your database:**

- **Creates only.** No `ALTER`, no `DROP`, no `TRUNCATE`, nothing touched on `projects`,
  `deals`, `contractors`, `auth_profiles`, `proposals` or `documents`. There is a test that
  fails if that ever stops being true.
- **RLS enabled, deny-by-default, on every one.** No permissive policy for the publishable key.
- **Both tenancy keys on every row**, so a row cannot be read without knowing whose it is.

**One thing worth raising while you are in there.** The publishable key can currently read
`contractors`, including `full_name` and `phone`, because those tables have no RLS. Publishable
keys are browser-safe by design, so that data is effectively public to anyone who has loaded the
app. Not ours to fix, but you should know.

---

## 5 · Send-to-CRM extension — Sing

Stamp project identity onto the contact in the same call: project name, address, contract
amount, and the shared key. You scoped it at about a day.

**Blocked on one decision** — see item 7, C-3. Three documents give three different answers for
what the shared key is, and measuring the live database gives a fourth problem: there is no
`BSP-` value anywhere in `projects`, and **`ghl_opportunity_id` is empty on all nine rows** for
the Alliance tenant. So neither candidate carries data today.

Whichever it is: one system generates it, the other copies, and it lives in a dedicated field on
both sides — never in the job title.

---

## 6 · Client-to-contractor matching — Sing

Still the thing that stops us narrowing the project list to signed work. Today the dashboard
reads every project on the account, including work that is not signed, because there is no
reliable join from a contractor to the deal they closed.

**Found it — we were looking in the wrong table.** "How is a bid classified as won" is not on
`projects`; it is on **`deals`**: `signature_status`, `signature_signed_at`, `sent_to_crm_at`,
`signed_pdf_url`, `adobe_agreement_id`. Joined to a project by `deals.source_project_id`.

So the filter is writable today. **What stops it is that the columns are empty:** of 182 deals,
5 are matched to a contractor, 2 have been sent to CRM, 1 signature has been sent and **none has
been signed**. Confirm we have the right column and we will filter on it the moment real data
arrives — `docs/kb/two-system-model.md` has the full funnel.

---

## 7 · Four decisions — Chris

Reconciling the documents surfaced four genuine conflicts. Detail in
`docs/SOURCE-OF-TRUTH.md`; the short form:

**C-2 · Client login.** The huddle says *email + project ID + verification link*. Your review §6
and the build strategy both say email plus project ID must never gate approvals, money or
documents. These reconcile only if **the verification link is the credential** and the project
ID is a lookup — a magic link. We are building it that way; please confirm.

**C-3 · The shared key.** BuildSuite project ID, or the GHL opportunity id? Blocks item 5.

**C-4 · Payments.** The build strategy routes payments through GHL's native Client Portal
invoices. The huddle says Stripe from each contractor's own account. Different rails. The
Payments screen stays a placeholder until this is answered — building it against the wrong one
wastes the work.

**C-5 · Media storage.** Contractor's GHL media storage, or Supabase? `hub_photos` and
`hub_documents` hold metadata and a path, so either answer works — but it blocks the upload and
recall path, which the huddle §8 wants traceable end to end.
