# Re: Supabase RLS — Project Hub, measured

**For:** Sing · **29 September 2026** · answering Part 1
**From:** Dale / Project Hub

---

## First, a correction that changes the urgency

Your table says the anon key gets **"reads come back empty with no error."** That
is not what is happening. Measured just now against BuildSuite production with
the key Project Hub uses:

```
projects         401  {"code":"42501","message":"permission denied for table ..."}
proposals        401  42501
contractors      401  42501
auth_profiles    401  42501
deals            401  42501
```

**401, not an empty array.** So table privileges were revoked from `anon`, not
only RLS switched on with no policies. Worth knowing because it changes what
other people will see: a hard error, not silently missing data.

The same key read 115 projects on 25 September, so the change is today's.

## Project Hub is down, and it is the sign-in that breaks first

Signing in resolves a GoHighLevel sub-account to `auth_profiles`. That read is
now denied, so **no contractor can sign in at all** — they reach "this
sub-account has no BuildSuite projects linked to it yet", which is the honest
message for a different problem.

Nothing that reads BuildSuite works: projects, proposals, signed contracts,
payment schedules, the client portal.

**This is ours to fix and the fix is one key.** Nothing needs to change on your
side for it, and I am not asking for a policy.

---

## The inventory you asked for

| App / workflow | Key type | Tables | Read or write | Server or browser | Working after test |
|---|---|---|---|---|---|
| **Project Hub → BuildSuite** | anon *(being changed to service role)* | `projects`, `proposals`, `deals`, `contractors`, `auth_profiles` | **Read only** | Server only | **No — 401 on every table** |
| **Project Hub → Hub database** (`nexpqqxarimqmntnvzff`, separate project) | service role (secret) | `hub_*` only — never BuildSuite | Read and write | Server only | Yes, unaffected |

Three things about that first row, since they answer several of your questions
at once:

1. **It cannot write to BuildSuite.** The client has no method that issues
   anything but `GET`, and it throws if a caller tries. That is structural, not
   a convention — the writing client is a different class against a different
   database, so "write to BuildSuite" is not expressible in this codebase.
2. **It is server-only.** The module carries Node's `server-only` marker, so
   importing it from a browser component fails the build.
3. **No key reaches the browser.** There is no `NEXT_PUBLIC_SUPABASE_*`
   anywhere, and a test fails the build if one appears.

**Not mine to answer:** n8n, House Intelligence and Material Takeoff are
separate codebases. Dale will confirm those separately — please do not take this
document as covering them.

---

## Answers to your specific questions

**Q5 — the eight `contractor_application*` / `*_classification*` policies.**
**Remove them.** Project Hub does not write to BuildSuite at all, so it cannot
be relying on them. It does not read those eight tables either.

**Q5 — `hi_select` on House Intelligence.** Not Project Hub's. Agreed in
principle that an anon policy letting anyone read every request including
addresses should go; Dale to confirm for that app.

**Q6 — key exposure.** No Supabase key in frontend code. Both keys are server
environment variables. The BuildSuite key has never been secret-grade, which is
part of why this is an easy fix rather than a rotation.

---

## What we are doing, and what we are not

**Doing:** switching Project Hub's BuildSuite reads to the **service role key**,
as a server environment variable. Same reads, same tenancy — every BuildSuite
read is already filtered by the signed-in contractor's own auth profile ids in
application code, and has been since August. RLS was never what kept one
contractor out of another's projects here.

**Not doing:** adding a policy, broad or narrow, to get it working again. Your
point 4 is right and we would have asked for the same.

**One question for you, purely about naming.** The variable is called
`SUPABASE_ANON_KEY`. We can either put the service key into it — one minute, and
the name then lies — or add `SUPABASE_SERVICE_KEY` and have the code prefer it.
We are doing the second unless you would rather we did not.

---

## Part 2 — Material Takeoff

Different codebase, not this one. Project Hub does not call the takeoff service
and does not read or write anything it produces. Dale is answering that half
separately.

One note that may be useful: Project Hub already treats an assumed figure as a
refusal rather than a number — an invoice with no chosen amount throws instead of
defaulting to zero, on the same reasoning you are applying to `needs_more_info`.
If it helps to compare shapes, the module is `lib/invoicing/`.
