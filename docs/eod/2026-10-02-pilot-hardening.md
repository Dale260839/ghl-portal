# Project Hub — the day we stopped the system telling us comfortable lies

**2 October 2026** · the pilot-hardening workstream
**Live at:** https://project-hub-one-vert.vercel.app

> There are two records for 2 October. [`2026-10-02.md`](2026-10-02.md) covers
> the scale work and the Health page. This one covers the hardening audit that
> ran in parallel on `codex/photo-flow-hardening` — seven code changes, about
> 2,200 lines, none of it deployed that day.

---

## The thread that runs through all of it

Every fix below is the same shape: **the software was reporting success it had
not earned.** A photograph that said it was filed. A screen that said a project
had no money in it. A webhook that said "processed". A draft that said it had
been saved.

None of those were crashes. Every one of them would have been found by a
contractor, in front of a client, weeks from now — which is the expensive way.

---

## 1 · A photograph attached to nothing

A live query against the pilot project found a photo with the correct task on it
and **no link to the update it belonged to**. The crew member had taken it, the
screen had accepted it, and it had quietly landed nowhere.

Task submissions now check every saved photo against the task and project the
person is actually allowed to touch, before anything is written. A count sent by
the form is no longer believed — only photos that genuinely linked are counted
in the message the PM sees.

And when linking fails anyway, **the update survives and says so**. The old
behaviour was to report a clean success.

**The existing broken record was left alone.** Repairing it by hand would have
destroyed the only evidence of whether the fix works on new submissions.

## 2 · "No projects" when it meant "I could not look"

The BuildSuite count returned zero when the read itself had failed — so a
database outage and a genuinely empty account looked identical on screen. A
contractor would have seen their work disappear and had no reason to think it
was anything other than gone.

Failed reads are now refused rather than rounded down to nothing. A confirmed
zero is still zero.

The project overview got the same treatment from the other side: an optional
proposal or team read that fails now reports the outage **in that section**
instead of taking down a page that had otherwise loaded correctly. The money
figures stay usable when only the optional read is down.

## 3 · The webhook that reported work it never did

GoHighLevel sent us events. The route logged them and returned **success**.
Nothing was executed. From GHL's side the integration looked healthy and
finished; nothing was happening at all.

It now returns an explicit "not available" and does not mark events processed,
so repeated attempts cannot be mistaken for completed work.

Signature checking was rebuilt at the same time: current Ed25519, legacy RSA and
relay HMAC each verified against their own header and key, with **no downgrade
path** — an invalid current signature can no longer fall through to a legacy one
that happens to pass.

**Honest limit:** this is truthful failure handling, not a working sync. Event
execution still needs a durable queue and confirmed record mappings, and must
not be switched on before them.

## 4 · The crew's draft that forgot the photographs

Close the tab mid-update and the text came back — but the photos didn't, and
neither did crew count, hours, weather or the decision checkbox. A crew member
in a basement with bad signal lost the part that was hardest to redo.

All of it is restored now, including a draft that is *only* photographs. The
project is locked to the one the photos belong to, and detaching a reference
keeps the text and never deletes the stored file.

A second defect was found while fixing the first: **revisiting an old success
URL wiped a newer unsent draft.** Cleanup now matches the exact submission it
was issued for, so an old link is harmless.

## 5 · A revoked user with a cookie that still worked

Someone removed from the team kept a valid session cookie, and the write paths
trusted the role inside it. Project, team, schedule, task, selection and invoice
writes now recheck **current** access before acting, and a downgrade applies
before PM review or publishing.

Visibility changes — the switches that decide what a homeowner can see — now
prove ownership through the tenant-scoped reader before writing, and can no
longer fall back to an in-memory save that reports success.

## 6 · The Health page, corrected before anyone relied on it

It had shipped the day before. Three problems: it printed raw database error
text, it treated a *failed* probe as proof a migration was absent, and it
demanded a fallback token that OAuth made unnecessary.

A page that reports a failure as a reassuring "not applicable" is worse than no
page, because people stop checking.

---

## What we learned about the live system

- **The Hub database has no backups.** The Free plan does not include them, and
  Supabase's own documentation notes that backups exclude Storage bytes even
  where they exist — so a database restore would not bring back a single
  photograph. Before client launch this needs protected exports, file copies,
  and a restore proven against an isolated target.
- All 23 Hub tables have RLS on, the media bucket is private, and no browser
  TRUNCATE grants remain.
- Migrations `0019`, `0020` and `0021` are already live. **Do not re-run them.**
- The GHL menu link carried a location claim and no verified identity. The
  hardened code refuses it — which is correct, and which is exactly why it could
  not be promoted without the replacement entry being ready first.

---

## What is *not* done, honestly

- **None of this was deployed on 2 October.** It sat on a branch.
- Webhook execution does not exist.
- Draft recovery lives in one browser tab's storage for one day. It is not
  offline mode, and in-flight uploads are not restored.
- Submission and photo linking are still two separate writes. The preflight
  checks narrow the window; they do not make it one transaction.

## Where the day went

Commits run 13:48 to 18:37. Before that: the live crew → PM → homeowner test on
the pilot project, the SQL that found the unlinked photo, and a read-only
inspection of the agency's GHL menu and Marketplace install around 15:45. The
morning is not reconstructable from the repository — the afternoon is, and it is
roughly five hours of committing on top of it.
