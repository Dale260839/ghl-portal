# Running the client walkthrough

Two things were built for this: a **presenter HUD** at `/hud`, and a **view
switcher** in the app header so one person can show all three experiences in one
sitting.

---

## The HUD

**Open [`docs/demo-hud.html`](demo-hud.html) by double-clicking it.** One
self-contained file — no server, no wifi, no build. Copy it to a second laptop or
a phone and it still works.

Put it on your **second monitor**. It is not part of the product and must not
appear on the shared screen.

The same thing is also served at **`/hud`** when the app is running, if you would
rather have it in a browser tab alongside everything else. Both are generated
from the same source, so they cannot drift:

```bash
npm run hud          # rebuild docs/demo-hud.html after editing the script
npm run hud:maps     # ALSO re-scrape the hover maps (needs the dev server up)
```

The words live in `apps/web/src/app/hud/script.ts`. Edit them and run
`npm run hud`.

**The hover maps are generated, not drawn.** `wireframes.ts` is scraped from the
running app by `scripts/build-wireframes.mjs`, so nav labels, their order,
section headings and button text come from the real pages. The hand-drawn first
version was wrong about the portal nav (eleven items when there are thirteen),
the project detail panels, and the number of buttons on the review screen — all
of which send the presenter's mouse to the wrong place. If a screen changes,
start the dev server and run `npm run hud:maps`; never edit `wireframes.ts` by
hand.

**Twenty-two steps, thirty-two minutes of talking.** With questions, expect an
hour — which is why step 0 promises forty. If they only have twenty minutes, do
the nine **★** steps and skip everything else; they carry the argument alone.

### What each step gives you

| Panel | What it is |
|---|---|
| **Where to hover** | A schematic of the screen you should be on, with the target lit in amber. Glanceable — you should not have to read it. |
| **Put the mouse here** | The same thing in a sentence, for when the map is ambiguous. |
| **Watch out** | What goes wrong on this step. Read these *before* the call, not during. |
| **Say** | The words. Spoken language, short sentences — say it in your own voice, don't recite it. |
| **Under the hood** | What is actually happening server-side. **Not for reading out** — it is there for when someone technical asks "where is that coming from", which is a question you answer badly if you improvise it. |
| **If they ask** | The objection that lands on this step specifically. |
| **Then** | The action that ends the step. |

### The annex

Below the numbered steps there is an **Annex** — seven steps covering how the
thing actually works: how the three systems fit together, where data lives, the
security model, what happens when something breaks, and what is still open.

**It is not part of the run.** It does not count toward the clock or the step
numbering. Jump into it when the call turns technical, and go back to where you
were afterwards. Answering architecture questions inside the walkthrough is how a
demo turns into a lecture; having nowhere to go when they are asked is worse.

Two annex steps carry names that must **not** be said on a client call —
`Sing` and `Pat` appear only in the internal Watch-out note. Externally both are
"the BuildSuite side".

### Controls

- **← →** move between steps (space and page up/down work too)
- **T** starts and pauses the clock
- Click any step in the left list to jump
- The step is kept in the URL, so a refresh mid-call doesn't lose your place
- **Print** lays every step out linearly on paper — worth having if you are
  presenting from a single screen and cannot keep the HUD open

The clock turns amber when you are more than a minute past where you should be.
"by here:" in the footer is the time you should be at by the end of the current
step — that is the number to glance at, not the total.

### The shape of the call

It deliberately runs **client-first**. The last meeting showed the database
before the product and the client counted one screen against a twelve-screen
demo. This order fixes that: GoHighLevel sign-in, a short pass through the
contractor view, then the control that makes us different, then straight into the
homeowner's portal.

The spine is **steps 9 → 14**: a field note is written, a PM edits what the
client will read, it gets published, then you switch sides and show the internal
complaint is not there. That sequence is the argument; everything else is context
around it.

**Two steps exist purely for honesty** — **17** ("what is not built yet") and
**19** ("what is live, what is not"). Do not skip them to save time. The trust
problem came from a gap between what was said and what was seen, and it does not
close by widening it.

Step 19 deliberately ends on the **From BuildSuite** screen, because that is the
one reading their real database. Finishing on live data rather than fixtures is
the point of putting it last.

### The dashboard is on real data now

As of 2026-08-20 the contractor screens read **BuildSuite's live Supabase**, not
fixtures. The banner says "Live BuildSuite data" and the projects are the
tenant's own. Step 4's watch-out in the HUD is now out of date if you have
pulled the latest — check the banner before you say anything about demo data.

What BuildSuite actually carries, measured: identity, client, city/state/zip,
start and end dates, a budget **band**, and its own status word. It carries **no**
progress, health, contract value, milestones, field updates or issues — those are
the Hub tables, still not created. Those screens are empty rather than
fixture-filled, on purpose: mixing invented updates into a list of real projects
is indistinguishable from the product working.

So on the call: the project list, client names and dates are real. The Field
Updates queue will be **empty**, which breaks the walkthrough's spine (steps
9-14). Run that part against fixtures by unsetting `SUPABASE_URL` locally, or say
plainly that updates arrive with the Hub tables.

### The one caveat you must not drop

The annex step *The two we are waiting on* says the project list **shows more
than it should**. That is true: we read every project BuildSuite holds for the
account, with no way yet to narrow it to signed work. Two things are blocking that, both covered in the annex step
*The two we are waiting on*:

1. **The client-to-contractor matching** is unfinished on the BuildSuite side, so
   there is no reliable join from a contractor to the deal they closed.
2. **We cannot locate how a contractor bid is classified** in the schema — the
   field or value Pat used to mark a bid as won. Until we find it we would be
   guessing at a filter we ought to be reading.

Neither blocks any screen. Both decide what the list contains, so somebody will
eventually count rows against their own numbers — much better they heard it from
you first.

Also get the data direction right, because saying it backwards makes it sound
like we do not know where their data lives: **leads start in GoHighLevel**, cross
into **BuildSuite** to be estimated and bid, hand **back to GoHighLevel** at
signing. The projects on the dashboard came out of BuildSuite, and BuildSuite got
them from GoHighLevel.

---

## The view switcher

Field crews and homeowners have no way to sign in yet — contractors arrive
through a GoHighLevel menu link, and the invitation flow that would give the
other two roles real accounts is designed but unbuilt
(`docs/kb/authentication-model.md`).

So there is a **"Viewing as" dropdown** in the header of all three surfaces. A
contractor can assume the field or client experience and hand it back.

### On the call

**Say what it is before they ask.** An orange bar appears across the top while a
view is assumed, and the step 11 script names it out loud:

> "This is a demo shortcut so I can show you both sides in one sitting. Your
> homeowner gets their own login by email invitation."

A contractor logging in as their own client looks like a hole if it is
discovered, and like a considered demo tool if it is announced.

### What it does and does not do

- **Only a contractor can start it.** Checked server-side against the real
  identity, so an assumed client view cannot be used to reach further.
- **The field view inherits your own tenant keys**, never the demo account's — a
  contractor scoped to one agency who switched into a field view carrying another
  agency's key would be looking at someone else's jobs.
- **The client view carries no tenant key at all**, because a client is scoped by
  contact (§9.1).
- **It is not a new privilege.** `/field` and `/portal` already admitted a
  contractor session before this existed; the dropdown is a shortcut to something
  the app already permitted.
- While a view is assumed, `/dashboard` redirects — use **Back to my account**.

### Turning it off

Set `DISABLE_VIEW_AS=true` and redeploy. It defaults **on** so the demo works
without another environment variable to forget.

**Delete it rather than disable it** once invitations ship: `lib/view-as.ts`,
`lib/view-as.test.ts`, `components/view-switcher.tsx`, and the three layout call
sites. Nothing else depends on it.

---

## Before the call

- [ ] GoHighLevel open and logged into the **Alliance** sub-account
- [ ] The Hub open in a second tab, signed in
- [ ] At least **one field update actually pending** — steps 9 to 11 have nothing
      to stand on without it
- [ ] Document and photo counts checked, so the numbers you say match the screen
- [ ] Browser at 110%, notifications off, HUD on the other monitor
- [ ] If the deployed site is refusing sign-in, run it on localhost and say
      nothing about it
