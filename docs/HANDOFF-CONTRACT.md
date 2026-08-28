# Send-to-CRM: the handoff contract

**For:** Sing · **From:** Dale · **Date:** 2026-08-28
**Status:** two fields blocked, one of them needs Chris rather than you

When a proposal is signed, BuildSuite's Send-to-CRM writes a payload onto the
GoHighLevel Contact. GoHighLevel creates the operational Project record from it,
and the Hub picks it up from there. This page is exactly what that payload must
contain.

**The Hub side is built and tested.** Once a valid payload arrives, WF1 runs and
creates 17 records without further work from us — verified end to end on
synthetic data (`src/lib/handoff/handoff.test.ts`). What follows is the half
that has to come from BuildSuite.

---

## 1. The payload

Written onto the Contact at Send-to-CRM. Field names are **snake_case exactly as
below** — they are transcribed from ARCHITECTURE §8.2 and the Hub validates
against them literally.

```json
{
  "buildsuite_project_id": "BSP-2026-000184",
  "project_name": "Kitchen remodel — Carr residence",
  "project_address": "1 Example St, Bellevue, WA 98006",
  "contract_amount": 82500,
  "client": {
    "name": "Chris Carr",
    "email": "chris@example.com",
    "phone": "555-0100"
  }
}
```

| Field | Type | Rule |
|---|---|---|
| `buildsuite_project_id` | string | **Required, unique, immutable.** Must match `BSP-YYYY-NNNNNN`. See §2 — this is blocked. |
| `project_name` | string | Required, non-empty |
| `project_address` | string | Required, non-empty |
| `contract_amount` | number | Required, finite. Currency, **not** a band. See §3. |
| `client.name` | string | Required, non-empty |
| `client.email` | string | Required, non-empty |
| `client.phone` | string | Required, non-empty |

Nothing else is expected. The Hub does not want milestones, tasks, photos or
documents in the handoff — those are created by WF1 on the GoHighLevel side
(§1.2).

**Every problem is reported at once, not one at a time.** The validator collects
all issues and returns them together, so a malformed payload costs one
round-trip rather than five.

---

## 2. The shared key — blocked, and it is Chris's call not yours

**This is the one that needs deciding before you can implement anything.**

ARCHITECTURE §5 says the key is `BSP-YYYY-NNNNNN`. I checked the live database
on 2026-08-28 and **no value in that format exists anywhere in BuildSuite**:

| Candidate | Format | Populated | Verdict |
|---|---|---|---|
| `projects.id` | UUID (`80ef9efa-62b5-…`) | **101 / 101** | Not the contracted format. This is what `deals.source_project_id` actually points at — all 47 of them. |
| `projects.project_code` | `BSA-NNN` (`BSA-002`) | 48 / 101 | Right idea, wrong format, and half empty. Unique where present. |
| `projects.award_code` | — | **0 / 101** | Empty everywhere. |

So a handoff sent today would be **rejected for every project in the database**.
The Hub refuses rather than inventing an ID, because a project created under a
made-up key can never be matched back to BuildSuite (§5).

This is open decision **C-3** and I am deliberately not resolving it. Two ways
forward, and Chris picks:

**Option A — BuildSuite mints the contracted id.** Add a column that generates
`BSP-YYYY-NNNNNN` on project creation, backfill the existing 101, and send that.
Matches the architecture as written, and matches C-3's proposed resolution: the
project is born in BuildSuite, so BuildSuite owns its identifier and GoHighLevel
copies it. Cost is yours, roughly a migration and a sequence.

**Option B — the contract changes to accept `projects.id`.** The UUID is already
100% populated and is already the join key `deals.source_project_id` uses. Cost
is ours: one pattern in `packages/contracts/src/ids.ts` and the tests that pin
it. Cheaper, but it means the `BSP-YYYY-NNNNNN` format in §5 stops being true and
every document referring to it needs correcting.

**My read, for what it is worth:** B is less work and the UUID already does the
job the key is for. A is more faithful to the documents and gives humans a
readable identifier, which matters on a job site. Either is fine; what is not
fine is starting implementation before it is chosen.

---

## 3. The contract amount — yours

`contract_amount` must be a finite number. BuildSuite has `budget_range`, which
is a band, and it has **two vocabularies in the same column**: 101 of 182 deals
use tokens (`5k_10k`, `under_5k`, `100k_plus`) and 37 are already written out
(`$15,000 - $50,000`, `$250,000+`). 22 are empty.

A band is not an amount, and picking one end of it would put a wrong number on a
contract. `projects.exact_budget` exists but was null on the rows I sampled.

**What is needed:** the signed proposal's actual total, as a number, travelling
with the handoff. If it already lives on `proposals`, pointing me at the column
is enough.

---

## 4. The client block — yours, and probably already done

`client.email` and `client.phone` are required. They exist on `deals` and on
`projects`, and were populated on the rows I checked.

Worth stating explicitly: **the Hub does not read them.** `DEAL_COLUMNS`
deliberately excludes `client_email`, `client_phone` and `access_token`, because
the publishable key permits them and the narrowest select is our half of that
exposure. So these travel in the handoff from BuildSuite, not from us.

---

## 5. What happens once a valid payload arrives

Verified on synthetic data. The Hub's half needs no further work.

```
1. Signature captured in BuildSuite            [BuildSuite]
2. Send-to-CRM assembles the §8.2 handoff      [BuildSuite]  ← §2 and §3 block here
3. GHL creates the Project, fires a webhook    [GoHighLevel] ← needs object key + secret
4. The Hub verifies and routes it to WF1       [Hub]  built
5. WF1 plans the setup                         [Hub]  built
```

WF1 then creates, for one project:

```
  1 x CreateProject               7 x CreateMilestone
  1 x AssociateContact            2 x CreateTask
  1 x AssociateOpportunity        1 x SetProgress  (10%)
  1 x AssignProjectManager        1 x NotifyInternal
  1 x PrepareClientPortalAccess   1 x RecordActivity
```

**It is idempotent.** A re-sent proposal or a retried webhook produces a single
`RecordActivity` and no duplicate milestones. You do not need to guard against
sending it twice.

**Unassigned projects are flagged, not silently accepted.** If no project manager
is supplied, WF1 still runs but raises an internal notification — an unassigned
project has nobody to receive the field-update review queue.

---

## 6. What I need back

1. **Chris:** option A or B for the shared key (§2). Everything else waits on this.
2. **Sing:** where the signed contract total lives, so `contract_amount` can be
   populated (§3).
3. **Sing:** confirm `signature_signed_at` is the column that means *signed*. The
   Hub's definition of won is `signature_signed_at` **or** `sent_to_crm_at`, and
   it is empty on all 182 rows so no sample can prove it.
4. **Pat:** the webhook secret, and confirmation that the Alliance tier supports
   Custom Objects. Without the object there is no Project record for step 3 to
   create.

**None of this is large.** The whole handoff is one payload and one decision. It
is worth doing now because the alternative is discovering all of it during the
first real signature.
