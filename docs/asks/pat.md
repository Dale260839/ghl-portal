# Three things, Pat — the first takes ten minutes

**From:** Dale · **Date:** 2026-08-28 · **Reading time:** 2 minutes

All three are GoHighLevel configuration. No code from you.

---

## 1. Does the Alliance sub-account tier support Custom Objects?

**Ten minutes, and it decides the shape of everything after the handoff.**

The whole operational model assumes a `Project` custom object in GoHighLevel:
milestones, tasks, stages, the calendar. If the tier does not support custom
objects, that record cannot exist and the target changes — so it is worth
checking before anyone builds against it.

**How to check:** in the Alliance sub-account, Settings → Objects. Either the
option is there or it is not. That is the whole answer.

If it is not available, tell me rather than upgrading anything — the fallback is a
different design, not a bigger invoice.

---

## 2. The Project object key

Once the object exists, I need its key — the API identifier, usually shaped like
`custom_objects.project`.

**What it unblocks:** the Hub reading operational state out of GoHighLevel.
Without it we read BuildSuite only, which holds projects and clients but no
milestones, tasks or progress. The code for the GoHighLevel path is written and
sitting behind that one value.

---

## 3. The webhook secret

The signing secret for webhooks pointed at:

```
POST https://project-hub-one-vert.vercel.app/api/ghl/webhook
```

**The receiver is built and refuses everything without it.** That is deliberate —
there is no development bypass, because an unverifiable webhook is not a webhook
and a dev-only bypass is one environment variable away from being a production
one. Right now it answers `503` and says the configuration is missing, so nobody
debugging it mistakes our problem for yours.

Once the secret exists it verifies the signature over the raw body, rejects
anything outside a timestamp window, and rejects replays.

**Event types.** I have mapped the documented names plus the obvious variants, and
matching tolerates case and separator differences so a near-miss still lands.
Unrecognised types answer `200` rather than an error — a webhook that returns 4xx
on unknown types gets switched off by whoever is watching the delivery log, and
then the ones we do handle stop arriving too. The first real delivery will tell us
the exact names; nothing needs guessing in advance.

Please send the secret through something other than email or chat. I will wire it
into Vercel's environment and it never enters the repository.

---

## Nothing else is waiting on you

For completeness, so you can ignore the rest: the shared-key format and the
payments rail are Chris's calls, and a database migration plus the handoff payload
are Sing's. Your three items are above and none of them needs anyone else first.
