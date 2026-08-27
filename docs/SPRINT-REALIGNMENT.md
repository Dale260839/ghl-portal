# Realignment sprint — make the chain complete

**Written:** 2026-08-28 · **Sprint:** 5 working days · **Owner:** Dale
**Basis:** [`docs/kb/two-system-model.md`](kb/two-system-model.md) — measured, not inferred

---

## 1. Why we are realigning

The last sprint finished its build items. Twelve of thirteen portal screens are real, 335 tests
pass, all eight workflows exist, the privacy gate works, permissions are a matrix. **The screens
are not the problem any more.**

Probing the live database changed what the problem is:

| Step | Count | % |
|---|---|---|
| Deals in BuildSuite | 182 | 100% |
| Linked to a project row | 47 | 26% |
| Matched to a contractor | 5 | 3% |
| Sent to CRM (handoff fired) | 2 | 1% |
| Signature sent | 1 | 1% |
| **Signature signed** | **0** | **0%** |

**No deal has ever been signed.** For the Alliance tenant specifically: 23 deals, all sitting at
`intake_started`, `intake_complete` or `draft_ready`. **Zero matched.**

The operational half of this system has never been handed a real project. So we are not blocked
on building project management — **nothing has yet reached the point where project management
begins.**

That is a different problem and it needs a different sprint.

### What we stop doing

- **No more portal screens.** Payments is the only one left and it is correctly blocked on C-4.
- **No more speculative GHL work.** `GhlDataSource` exists; it needs a key, not more code.
- **No more building against imagined data.** Everything this sprint reads is a column that
  exists today.

### What we start doing

**Make the pipeline visible, and make the system ready to receive a signed deal the hour one
arrives.** Two goals, and the first one matters most: right now nobody can see that the funnel
is empty except by running SQL. The people who can fix it cannot see the thing they need to fix.

---

## 2. The sprint

Five days. **Every item is unblocked** — all of it reads columns that already exist, or builds
paths that do not need a credential we lack.

### Day 1 · Read the deals table

BuildSuite's `deals` is the matching and proposal engine and the Hub has never read it.

| | h |
|---|---|
| `BuildSuiteDealsReader` — tenant-scoped `select` on `deals`, narrow column list, read-only like the projects reader | 2.5 |
| `Deal` type + `toDeal` mapping. Measured fill rates decide which fields are trustworthy | 1.5 |
| `dealFunnel(scope)` — counts per lifecycle stage, one `count` request per stage rather than pulling rows | 2.0 |
| Tests: tenancy refused without a scope, the funnel arithmetic, an empty tenant returns zeros not a crash | 2.0 |

**Column list** (narrow, same discipline as `PROJECT_COLUMNS`): `id`, `status`, `source`,
`created_at`, `updated_at`, `auth_profile_id`, `source_project_id`, `matched_contractor_id`,
`sent_to_crm_at`, `signature_status`, `signature_signed_at`, `client_name`, `project_type`,
`budget_range`, `ghl_contact_id`, `ghl_opportunity_id`, `coverage_score`.

**Deliberately NOT selected:** `access_token`, `client_email`, `client_phone`, `photo_urls`,
`photo_analysis`, `metadata`, `signed_pdf_url`. The Hub has no screen that needs them, and the
narrowest select is our half of the publishable-key exposure.

**Ships:** the Hub can see the pipeline for the first time.

---

### Day 2 · The pipeline screen

`/dashboard/pipeline` — a contractor-side funnel view. This is the screen that makes the finding
visible to the people who can act on it.

| | h |
|---|---|
| Funnel panel: intake → complete → draft ready → contractor selected → proposal sent → signed → sent to CRM, with counts | 3.0 |
| Deal list under it: client, type, budget band, status, age, whether it is linked to a project | 2.5 |
| **Stalled highlighting** — a deal sitting in one stage beyond a threshold. A funnel with no time dimension hides the actual problem, which is that things stop rather than that counts are low | 1.5 |
| Tests, including the empty-tenant case | 1.0 |

**What Alliance will see on day 2:** 23 deals — 4 at intake started, 3 intake complete, 16 draft
ready, **0 matched, 0 signed** — with the oldest ones flagged as stalled.

**Ships:** the blocker stops being something I describe in a message and becomes a screen Chris
can open.

---

### Day 3 · The join, and the signed-only filter

| | h |
|---|---|
| Join `deals.source_project_id → projects.id`, both directions, on the tenant-scoped set | 2.5 |
| `isSignedWork(deal)` — true when `signature_signed_at` is set, or `sent_to_crm_at` is set. The definition lives in one function with the reasoning beside it | 1.0 |
| Signed-only filter on the projects list, **behind a flag defaulting OFF** | 2.0 |
| A banner on the project list stating plainly that it shows unsigned work, with the count, until the filter can be switched on | 1.0 |
| Tests: the filter, the join, and that a project with no deal is not silently dropped | 1.5 |

**Why the flag defaults off:** switching it on today empties the list — nothing is signed. The
filter must exist and be tested before data arrives, but it must not be the reason a contractor
opens the dashboard to nothing.

**A project with no linked deal is shown, not hidden.** 26% of deals link to a project, so the
reverse join is sparse. Hiding unlinked projects would hide most of the book of work and look
like data loss.

**Ships:** the filter Sing has been blocking, ready to switch on the day the columns fill.

---

### Day 4 · The handoff path

What happens the moment a deal *is* signed. Built now so the first one is not spent debugging.

| | h |
|---|---|
| Wire `sent_to_crm` to **WF1 New Project Setup** through the webhook router — the planner exists and is tested; this connects the trigger | 2.5 |
| `HandoffPayload` contract: what BuildSuite must send at Send-to-CRM (project id, name, address, contract amount, client, and the shared key) | 1.5 |
| Write it up as a one-page spec for Sing, with the exact field names and an example payload | 1.5 |
| A staging path that replays a synthetic signed deal through the whole chain, so the sequence is provable before real data | 2.5 |

**The shared key, per C-3's resolution:** BuildSuite generates the project id; GoHighLevel stores
and copies it. The contract says so explicitly so there is no ambiguity when Sing implements it.

**Ships:** the day a deal is signed, the chain runs instead of being investigated.

---

### Day 5 · Prove it, then hand over

| | h |
|---|---|
| End-to-end rehearsal on staging data: seeded deal → matched → signed → handoff → project → contractor sees it → PM publishes → client sees it | 3.0 |
| Fix whatever that rehearsal breaks — it will break something | 2.0 |
| Update the demo HUD with the pipeline screen and the real funnel numbers | 1.0 |
| The ask: one page for Chris, one for Sing, one for Pat, each with only their items | 1.0 |
| EOD + sprint close | 1.0 |

**Ships:** a demonstrated end-to-end run, on synthetic data, of the loop that has never completed
on real data.

---

## 3. How the system behaves after this sprint

### The contractor

**Before.** Opens the dashboard, sees 27 projects with no way to tell signed from unsigned, and
no visibility of anything upstream of a project. The pipeline is invisible.

**After.** Opens the dashboard and additionally has a **Pipeline** screen showing every deal by
lifecycle stage with counts and ages. For Alliance that reads: *23 deals, 16 sitting at draft
ready, none matched to a contractor, none signed* — with the oldest flagged.

The projects list carries a banner: *"Showing all work. 0 of 27 projects are on signed deals —
the signed-only filter turns on when signatures start landing."* One switch flips it.

### The field crew

**Unchanged.** Their loop does not depend on the deal pipeline — they work assigned projects.

### The client

**Unchanged this sprint.** Still on sample content, because the operational records live in GHL
and we still cannot read it.

### When a deal is signed — the new behaviour

Today: nothing happens. `sent_to_crm_at` gets a timestamp and no system reacts.

After this sprint, given the webhook secret and the GHL object:

```
BuildSuite: signature captured → sent_to_crm_at set → Send-to-CRM fires
   → GHL creates the operational Project record, stamped with the BuildSuite id
   → GHL webhook notifies the Hub  (verified, replay-protected)
   → WF1 runs: milestones, default tasks, progress 10%, portal access prepared
   → the project appears on the contractor dashboard as signed work
   → the signed-only filter now has something to show
```

**Without the secret and the object**, the same chain runs to the third line and stops with a
logged, verifiable reason rather than silence.

### What still will not work

| | Why |
|---|---|
| Reading operational state from GHL | No object key; the tier is unconfirmed |
| Real client portal content | Updates, photos, documents live in GHL |
| Payments | C-4 undecided — deliberately unbuilt |
| Live webhooks | No real secret from Pat |
| Per-contractor rollout | The snapshot test has never run |
| **A real signed deal** | **Not ours. This is the one that matters.** |

---

## 4. Exit criteria

The sprint succeeded if all of these are true:

1. A contractor can see the deal funnel for their own tenant, tenant-scoped and tested
2. The signed-only filter exists, is tested, and is one flag away from being on
3. `deals.source_project_id → projects.id` is joined in both directions with tests
4. A synthetic signed deal completes the whole chain on staging and the run is recorded
5. Sing has a one-page handoff contract with exact field names and an example payload
6. Nothing in the client portal or the field interface regressed — full suite green

It failed if we built more screens instead.

---

## 5. Risks

**`deals.auth_profile_id` is 53% populated.** Tenant scoping on deals is partial, so a
tenant-scoped funnel undercounts. Alliance resolves to 23 deals; some of its deals may carry no
profile and be invisible. *Mitigation:* state the coverage on the screen rather than presenting
the count as complete, and raise the gap with Sing.

**`deals.status` vocabulary is BuildSuite's and may change.** Six values observed. *Mitigation:*
an unrecognised status renders in its own bucket rather than being dropped or mapped.

**The rehearsal is synthetic.** It proves our half, not GHL's. *Mitigation:* say so; it is not a
substitute for the go/no-go tests.

**The Custom Objects tier answer could invalidate day 4.** If the tier does not support them,
there is no GHL Project record to hand off to and the target changes. *Mitigation:* day 4's
payload contract is useful either way; the wiring is one file.

---

## 6. Dependencies

Nothing in the sprint waits on these, but the system stays incomplete without them.

| Who | What | Blocks |
|---|---|---|
| **Chris + Pat** | Custom Objects on the Alliance tier — 10 minutes | The whole operational model |
| **Chris** | Payments rail: GHL native or Stripe | The last portal screen |
| **Chris** | Confirm the verification link is the credential | Client login going live |
| **Chris** | Confirm BuildSuite owns the shared id (C-3 proposal) | Sing's handoff work |
| **Chris / ops** | **Get one deal signed** | Everything downstream |
| **Pat** | Object key · webhook secret | GHL reads · live triggers |
| **Sing** | Run `0001_hub_tables.sql` (nine tables, create-only) | Hub-owned records |
| **Sing** | Send-to-CRM identity stamp — spec arrives day 4 | Closing the join |
| **Sing** | Confirm `signature_signed_at` is the right "won" column | Signed-only filter |

**The one to press.** Everything technical here is small. The item with no technical content —
one deal reaching signature — gates more than the rest combined.
