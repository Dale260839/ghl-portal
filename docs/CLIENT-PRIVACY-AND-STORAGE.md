# Four confirmations, and the storage decision

**Date:** 2026-09-09 · Every claim below was verified by **breaking it and
watching a test fail**, not by reading the code and believing it.

---

## How these were confirmed

A passing test proves nothing on its own. So for each guarantee I introduced the
exact violation it exists to prevent and confirmed the suite caught it:

```
CAUGHT  1. Internal notes reach a client
CAUGHT  2. Approval no longer required
CAUGHT  3. Work log published as the summary
CAUGHT  4. Cross-project access allowed
CAUGHT  5. Portal master switch ignored
CAUGHT  6. Update date fabricated
CAUGHT  7. Publish date fabricated
```

**Two of these did not pass the first time**, and that is the most useful thing
in this document — see §6.

---

## 1 · Internal field notes can never reach a client response — CONFIRMED

Enforced in three independent places, any one of which would stop a leak.

**The type is an allow-list, not a filter.** `ClientUpdateView` has exactly four
fields:

```ts
{ id, updateDate, clientSummary, publishDate }
```

Built with an object literal. `internalNotes` is never read, so a new internal
field added to `DailyUpdate` tomorrow cannot appear here — someone would have to
add it deliberately.

**A deny-list runs over the result.** `assertNoInternalFields` walks the
projected payload recursively, including nested objects and arrays, and throws
if any §9.3 name appears. Matching is on a normalized key, so `Internal Notes`,
`internal_notes` and `internalNotes` are all the same field.

**The §9.3 list is transcribed verbatim** in `packages/contracts/src/deny-list.ts`
— 15 entries including Internal Notes, Vendor Cost, Markup, Margin, Profit,
Private Team Messages, Internal Risk Assessment, Delay Reason.

**Proof:** adding `internalNotes: u.internalNotes` to the projection fails the
suite immediately.

---

## 2 · PM approval is required before publication — CONFIRMED *(after a fix)*

The gate's second clause:

```ts
record.managerApprovalStatus !== null &&
record.managerApprovalStatus !== PUBLISHED_APPROVAL_STATUS
  → denied
```

`Approved Internally` does **not** satisfy it. Only `Approved & Published` does,
which is §10's distinction and the one most likely to be got wrong.

`managerApprovalStatus` exists on exactly one type in the system —
`DailyUpdate` — which matches the gate's "(where applicable)" clause. Nothing
else has an approval step to skip.

**Proof:** deleting the clause now fails the suite. It did not before today —
see §6.

---

## 3 · Clients see only approved summaries and update dates — CONFIRMED *(after a fix)*

The four published fields are the whole client-facing surface of an update:

| Field | Source |
|---|---|
| `clientSummary` | the PM's summary — **never** `workCompleted` |
| `updateDate` | the recorded date |
| `publishDate` | the recorded date |
| `id` | — |

`workCompleted`, `crewOnsite`, `hoursWorked`, `weather`, `submittedBy` and
`internalNotes` are all left behind.

The field crew writes two separate boxes — Internal Field Notes and a Suggested
Client Progress Summary — and there is no publish button anywhere on the field
interface. The crew proposes; the PM publishes.

**Proof:** publishing `workCompleted` in place of `clientSummary` fails, and so
does fabricating either date.

---

## 4 · Each client can access only their own project — CONFIRMED

Enforced twice, at different layers, and neither depends on the other.

**At the read.** `clientProjectsFor` returns only the projects a homeowner was
ticked into, read by id. An empty assignment list returns empty — there is no
value of it that means "everything". An invited client inherits **no** auth
profiles, so there is no tenant scope they could over-read with even if a screen
forgot to filter.

**At the gate.** Clause four is `requester.associatedProjectIds.includes(record.projectId)`.
A record belonging to another project is denied even if it were somehow fetched.

§1.4 is respected throughout: a contact **may** have several projects, and the
portal shows a switcher rather than collapsing them to one.

**Proof:** neutering the gate clause fails the suite; so does neutering the
per-project portal switch.

---

## 5 · Supabase folder and file-storage structure — DECIDED

### The shape

```
hub-media/                                   ← one private bucket
  <contractor_id>/                           ← tenant boundary, FIRST segment
    <buildsuite_project_id>/                 ← the job
      photos/                                ← site photography
        <uuid>-<original-filename>
      documents/                             ← contracts, permits, drawings
        <uuid>-<original-filename>
```

### Why each level is where it is

**Contractor first, always.** When storage policies are written, the rule is a
prefix match on segment one and nothing has to be re-filed. Getting this wrong
is a migration of every file in the system; getting it right costs nothing now.

**Project second** so a whole job can be listed, exported or removed as a unit —
which is what a contractor asks for when a job closes.

**Kind third** rather than mixing types in one folder, so a photo grid does not
have to filter out PDFs, and a document list does not have to filter out photos.

**UUID prefix on the filename, original name preserved.** Two people uploading
`photo.jpg` do not collide, and a homeowner downloading `contract.pdf` still
receives `contract.pdf` rather than `a3f9e2.pdf`. Filenames are sanitised to
`[a-zA-Z0-9._-]` and capped at 80 characters.

### The bucket is private, and that is the whole point

`public = false`.

A public bucket hands out permanent unguessable URLs, and **unguessable is not a
permission** — a link that leaks stays valid forever and cannot be revoked. We
have a live example of exactly that failure mode: `proposals.signed_pdf_url` is
a public URL, and Sing had to warn us to treat it as sensitive precisely because
possession of the link is possession of the contract.

So every file is served through a **signed URL minted per request**, after the
§9.1 gate has decided this person may see this record. TTL is **600 seconds** —
long enough to open a PDF or load a photo grid, short enough that a copied URL
in a chat log is dead by the time anyone tries it.

### Limits

```
file_size_limit   50 MB     a phone photo or a scanned contract, not a video
allowed_mime      jpeg png webp heic heif · pdf · doc docx xls xlsx · txt csv
```

HEIC is included deliberately: it is what an iPhone produces by default, and
omitting it would fail exactly the upload a crew member makes on site.

### What is deliberately NOT decided yet

**Per-contractor storage policies.** `0006` grants the anon role access to
`hub-media` and only that bucket, without scoping by contractor — matching the
posture of `0002`, which turned table RLS off while access patterns settle. The
path layout means those policies are a prefix rule when RLS returns, written in
the same pass as the table policies. **This inherits `0002`'s deadline: it stops
being acceptable the day a second contractor uses the system.**

**Retention and deletion.** Nothing deletes a file today. `HubClient` has no
delete method at all, by design. When a retention rule exists it belongs here.

**Virus scanning.** Not in place. Worth a decision before a homeowner can upload,
which they cannot today.

---

## 6 · What I got wrong, and what it means

Two of the four guarantees **passed their tests and were not actually enforced**.
I would have confirmed them on the strength of a green suite.

### The approval clause had never been tested

Every unapproved fixture also has `clientVisible: false`:

```
du-1  Pending               clientVisible=false
du-2  Pending               clientVisible=false
du-3  Approved & Published  clientVisible=true
du-4  Approved & Published  clientVisible=true
du-5  Approved Internally   clientVisible=false
```

The two conditions are **perfectly confounded**. Every unapproved update was
already denied by clause one, so clause two never decided anything. Deleting the
approval check entirely left the whole suite green.

Fixed by constructing the one combination no fixture contains — `clientVisible:
true` with an unapproved status — which is the only case that isolates the
clause. §10 keeps `Client Visible = No` at `Approved Internally` in real data;
the test forces it true precisely so approval is the only thing left that can
deny.

### The summary test checked the shape, not the value

```ts
assert.deepEqual(Object.keys(view).sort(), ['clientSummary', 'id', 'publishDate', 'updateDate']);
```

Swapping `clientSummary: u.clientSummary` for `clientSummary: u.workCompleted`
keeps those same four keys. The test is named *"carry the summary and never the
work log"* and never looked at the work log. It now compares values, and asserts
the summary is **not** equal to the work log.

### The lesson, which is not new

Both were tests that asserted the shape of a thing rather than the thing. Both
had reassuring names. Neither had ever been seen to fail.

**The rule this repo now follows: a guarantee is not confirmed until the
violation has been introduced and the failure observed.** That is how these four
were checked, and it is why two of them needed work first.
