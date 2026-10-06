# Project Hub — release day, and the door that closed behind it

**5 October 2026** · the pilot-hardening workstream
**Live at:** https://project-hub-one-vert.vercel.app

> Release day for the work described in
> [`2026-10-02-pilot-hardening.md`](2026-10-02-pilot-hardening.md). Little new
> code — a day of proving, documenting and shipping, which is what the end of a
> hardening cycle looks like when it is done properly.

---

## 1 · The entry GoHighLevel would actually accept

A white-label CRM entry was added at `/auth/crm`.

The reason is small and entirely about someone else's validator: GoHighLevel's
white-label form **rejects a URL containing `ghl`**, so the existing
`/auth/ghl` address could not be saved into a white-labelled menu at all. The
new route is a neutral alias — two lines, re-exporting the same page, so there
is no second sign-in implementation to keep honest.

It came with 66 lines of test holding exactly that: the two routes must be the
*same component*, signed claims must survive the alias intact, and an
array-valued parameter must not be accepted as a forged claim.

## 2 · Proving it, rather than asserting it

The full regression was run — **1,377 tests**, typecheck and production build —
and a protected preview deployment was verified end to end.

The live acceptance work on the pilot project:

- A crew update with a photograph, submitted as a crew member
- The PM seeing it, and releasing only the selected content and photo
- The real test homeowner seeing the published summary and the released photo
  at full size, and **not** seeing internal notes, costs or unapproved photos
- Cross-project and revoked-member file requests refused **by the server** — a
  hidden button was explicitly not accepted as evidence

## 3 · A handover written for someone who wasn't there

229 lines of it, and the valuable parts are the warnings rather than the steps:

- **Do not re-run `0019`, `0020` or `0021`.** Live schema checks confirmed all
  three are present. The dashboard's migration label had been suggesting
  otherwise, and acting on it would have been the damaging move.
- **Reuse the existing shared secret. Do not press Generate.** The presence of a
  Generate button had earlier been mistaken for evidence the secret was missing;
  that correction is recorded.
- **Keep deployment protection on.** Do not solve a test-access problem by
  exposing the deployment or restoring unsigned production sign-in.
- The new secure entry had been proven on a *protected preview only*. Production
  cutover was flagged as needing separate owner approval.

That last point is the one that mattered most, and it was right.

---

## 4 · What happened at cutover

The branch was merged to `main` and production **blocked the deployment** — the
commit author was a GitHub account without contributing access, which the Vercel
Hobby plan refuses on a private repository. The merge was re-authored and the
release went out.

Then the predictable thing happened, and it was the correct thing.

The hardened code had deliberately removed the old proof mode: a location lookup
made with *our own* credential, which confirms a sub-account exists and says
nothing whatever about who is asking. With that gone, the live menu link — the
only way contractors sign in — stopped working, exactly as the handover had
warned it would.

**This was the hardening working, not failing.** Until that release, anyone who
learned the sign-in URL could have substituted another contractor's location id
and been handed their projects, with 149 sub-accounts to choose from.

Restoring sign-in on the Marketplace Custom Page path, and the configuration
behind it, was taken up in the other session the same evening and is written up
in [`GHL_Auto_Login_Setup.md`](../GHL_Auto_Login_Setup.md).

---

## What is *not* done, honestly

- The handover's own checklist was written against a preview. The merge put it
  in production the same day, so several items on it describe a state that has
  since moved.
- Webhook execution still does not exist.
- Hub database backups still do not exist on the Free plan, and Storage bytes
  would not be covered even if they did. That remains the largest unaddressed
  risk in front of a client launch, and no amount of test coverage touches it.

## Where the day went

Three commits land in six minutes (15:14–15:20), which is the wrong way to read
the day. The code was a morning's work; the hours went into the live acceptance
run on the pilot project, the full regression, the preview verification, and
writing the handover — then into the merge, the deployment block, and the
cutover consequence that followed it.
