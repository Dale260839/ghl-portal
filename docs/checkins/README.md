# Daily check-ins

**Established:** 2026-09-10.

One file a day: what moved, what is blocked, what needs a decision, what is
next. Five minutes, generated not assembled.

```bash
npm run checkin           # writes docs/checkins/YYYY-MM-DD.md, never overwrites
npm run checkin -- --dry  # print it instead
```

---

## Why this is separate from the EOD

There are eighteen EODs in `docs/eod/` and they are good — narrative, honest,
and worth reading back. They are also **long**, written **at the end**, and
therefore written on the days that went well.

A check-in is the other thing:

| | Check-in | EOD |
|---|---|---|
| When | Any time, ideally early | End of a working day |
| Length | A screen | However long the day was |
| For | Whoever is waiting on you | The record |
| Point | Surface a blocker **while someone can still act on it** | Say what happened |

A blocker raised at 6pm costs a day. The same blocker in a morning check-in
costs an hour. That is the entire argument for having both.

**Both, not one.** The EOD stays.

---

## What the script fills in, and what it will not

It reads git and the filesystem. **No network** — a check-in has to be writable
on a train, and both Supabase hosts were unreachable from this machine for a
stretch on 2026-09-10 while everything else worked fine.

**Filled in:** branch and HEAD, commits today, both remotes' ahead/behind *with
how stale those refs are*, uncommitted file count, a surface test count,
migrations present, and every red blocker from `../BLOCKERS.md`.

**Left blank, deliberately:** what is actually done, what is stuck, what needs
deciding, what is next, and what surprised you. Those are judgement, and a
template that pre-fills judgement gets filled in with the template's words.

---

## The five sections

**1 · What moved.** The commit list is generated; the sentence is not. "Done"
means merged, tested, and someone else could use it — not "worked on".

**2 · What is blocked.** A blocker is something **you cannot resolve alone**.
Name who it waits on and since when, or it is a task you have not started.
New ones go in `../BLOCKERS.md` so tomorrow carries them.

**3 · What needs a decision.** Different from blocked: you have an answer, it is
just not yours to give. A schema question, a product call, a §16 open decision.
**Say what you would do if nobody answers, and by when you need to know** —
that turns a question into something someone can approve rather than solve.

**4 · Next.** One to three things. More than three means the first is not small
enough.

**5 · Anything that surprised you.** Optional, and over time the most valuable.
A number that was not what you expected, a test that passed for the wrong
reason, data that contradicts an assumption. Nearly every real finding in this
project arrived this way: `proposals.contractor_id` null on a signed row,
eleven portal screens resolving a client that no longer exists, a milestone edit
writing to `completed_date`. None of those were on anybody's plan.

---

## Rules that keep it honest

- **Never overwrite.** Re-running opens the existing file rather than replacing
  it, so a morning check-in cannot be silently erased by an afternoon one.
- **Say when the remote counts are stale.** The script does not fetch, so it
  prints how old the refs are. `0 behind` from a three-day-old ref is worse than
  saying nothing — it is a fact-shaped statement that is false.
- **If a red blocker is more than a week old, escalate it by name** in section
  2. A list nobody escalates from is a list nobody reads.
