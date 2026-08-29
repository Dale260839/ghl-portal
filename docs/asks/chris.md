# Four decisions, Chris — and one that outranks them

**From:** Dale · **Date:** 2026-08-28 · **Reading time:** 3 minutes

Everything technical in this sprint is finished. What is left is not code.

---

## 0. The one that outranks the rest: get one deal signed

**No deal has ever been signed.** Not one, out of 182. I measured it against the
live database rather than inferring it.

| Step | Deals | |
|---|---|---|
| Created | 182 | 100% |
| Linked to a project | 47 | 26% |
| Matched to a contractor | 5 | 3% |
| Sent to the CRM | 2 | 1% |
| Signature sent | 1 | 1% |
| **Signature signed** | **0** | **0%** |

For Alliance specifically: 23 deals, **none matched to a contractor**, 16 sitting
at "draft ready", 17 untouched for more than 60 days, the oldest for 174.

This is not a build problem. Everything downstream of a signature is written and
tested — I rehearsed the whole chain end to end this week and it completes. What
it has never had is a real project to run on.

**The ask:** one client, matched to a contractor, proposal sent, signed. One.
Until that happens every remaining item is untestable, and we are guessing.

You can see this yourself now — **Pipeline** in the dashboard sidebar. It was
invisible until this week because the Hub read `projects`, which is the far end
of the pipeline, and never read the table where matching actually happens.

---

## 1. The shared key — `BSP-YYYY-NNNNNN`, or what BuildSuite already has?

**This blocks Sing.** He cannot implement the handoff until you pick.

The architecture says the key joining BuildSuite and GoHighLevel is
`BSP-YYYY-NNNNNN`. **No value in that format exists anywhere in BuildSuite.**
What does exist:

| | Format | Populated |
|---|---|---|
| `projects.id` | a UUID | **101 / 101** |
| `projects.project_code` | `BSA-002` | 48 / 101 |
| `projects.award_code` | — | 0 / 101 |

Worth knowing: the build-context document names the format `APS-081`, and
BuildSuite holds `BSA-002`. Same shape, different prefix — `project_code` is very
likely what was meant, and nobody had looked at that column until this week.

**Option A — BuildSuite mints `BSP-YYYY-NNNNNN`.** Faithful to the architecture,
readable on a job site. Costs Sing a migration and a sequence.

**Option B — the contract accepts `projects.id`.** Already universal, already the
link the deals table uses. Costs us one line and some tests. But then the format
written into several documents stops being true.

**My recommendation: B**, unless a human-readable job number matters to your
field crews — in which case A, and it is worth the extra day. Either is fine.
Starting implementation before you choose is not.

---

## 2. Payments: GoHighLevel invoices, or Stripe?

The last unbuilt portal screen. I have deliberately not started it, because the
two answers produce different screens and rebuilding it is pure waste.

Not urgent unless you want payments in the first release.

---

## 3. Is the verification link the client's credential?

Homeowners get an email invitation and set their own password. What I need
confirmed is whether that emailed link is sufficient on its own, or whether a
homeowner must also match on something they already know.

It decides whether client login can go live, and it is a five-minute answer.

---

## 4. Where do photos and documents live?

GoHighLevel media, or our own storage. It affects the portal's document and photo
screens and nothing else.

---

## What you should know without being asked

**The demo is thinner than it was.** On your instruction I removed the sample-data
toggle, so the app now shows only real data. That is the right call and it also
means the walkthrough's centrepiece — an update arriving, being approved, and the
homeowner seeing it — has nothing to demonstrate. The rule is built and tested;
there is simply no record to point at.

**One task fixes it:** Sing running a migration that creates nine tables. It
creates nothing else and alters nothing existing. It is item 1 on his page.

Until then, run the call on what is real: sign-in, the project list, **Pipeline**,
and "From BuildSuite". Pipeline is the strongest thing we have — live, specific,
and it says something true that is worth hearing.
