import type { ScreenId } from './wireframes.ts';

/**
 * The client walkthrough, written to be read off a second monitor mid-call.
 *
 * Shaped by the meeting where the client called the system backward. Two things
 * follow from that, and both are structural rather than cosmetic:
 *
 *   1. **Lead with the client portal's shape, not the contractor's.** They
 *      counted screens. Twelve nav items now exist, so let them be seen early
 *      instead of arriving twenty minutes in.
 *   2. **Prove the one thing the demo they liked cannot do.** Any portal can
 *      show a homeowner a progress bar. Ours is the only one where a contractor
 *      decides, switch by switch, what crosses — and where an internal note
 *      provably does not. Steps 7 to 13 are that argument, told once, end to end.
 *
 * Nothing here claims a screen that is not built. The two honesty steps (15 and
 * 17) are load-bearing: the trust problem was created by a gap between what was
 * said and what was seen, and it does not get repaired by widening it.
 */

export interface Step {
  /** Short title for the step list. */
  title: string;
  /** Planned seconds — the running total is what keeps the call honest. */
  seconds: number;
  screen: ScreenId;
  /** Block id in that screen's map. Omit when the step is not about a place. */
  hotspot?: string;
  /** One line: literally where the mouse goes. */
  hover: string;
  /** The words. Spoken, not read — short sentences on purpose. */
  say: string;
  /** What goes wrong here. */
  watch?: string;
  /** The action that ends the step. */
  then: string;
  /** Objections that land on this step specifically. */
  ifAsked?: { q: string; a: string }[];
  /** The moments the whole call is for. */
  star?: boolean;
  /**
   * What is actually happening server-side on this screen.
   *
   * Not for reading out. It is there for the moment someone technical asks
   * "hang on, where is that coming from" — which is a question you answer
   * badly if you improvise it, and which is usually asked by the person whose
   * opinion decides the contract.
   */
  backend?: string;
  /**
   * `annex` steps are not part of the walkthrough. They are the architecture
   * answers, parked at the end so they do not pad the run time, and jumped to
   * when the conversation turns technical.
   */
  section?: 'walkthrough' | 'annex';
}

/** Steps that make up the timed walkthrough — the annex is excluded. */
export function walkthroughSteps(steps: Step[] = STEPS): Step[] {
  return steps.filter((s) => s.section !== 'annex');
}

export const TITLE = 'BuildSuite Project Hub';
export const SUBTITLE = 'client walkthrough · keep this on your second screen, not the shared one';

export const STEPS: Step[] = [
  {
    title: 'Before you share screen',
    seconds: 45,
    screen: 'ghl',
    hover: 'Nowhere yet. Hands off the mouse until the share starts.',
    say: 'Thanks for making the time. Last time we showed you the plumbing before the product, and that was our mistake. Today I want to go the other way round: start with what your homeowner sees, then show you the control you have over it. About forty minutes, and stop me whenever.',
    watch:
      'Close this HUD off the shared screen. Close Slack and email. Have GoHighLevel already open and logged in, plus a second tab on the Hub. Zoom the browser to 110% so text is readable on their end. If the deployed site is refusing sign-in, run the whole thing on localhost and say nothing about it. The clock below counts talking time only — with questions this runs closer to an hour, so if they have twenty minutes, do the eight starred steps and skip the rest.',
    then: 'Wait for the go-ahead, share the screen, and land on GoHighLevel.',
  },

  {
    title: 'Opening — it lives inside GoHighLevel',
    seconds: 90,
    screen: 'ghl',
    hotspot: 'menu-link',
    hover: 'The Project Hub item in the GoHighLevel left menu. Hover it, do not click yet.',
    say: 'This is your GoHighLevel account — nothing new to learn, nothing new to log into. The Project Hub sits in the same left menu as everything else your team already uses. One click, no second password.',
    watch:
      'Make sure you are in the Alliance sub-account before you click. If the menu link is missing, skip straight to the sign-in page and say the menu item is a GoHighLevel setting we hand over at the end.',
    then: 'Click it. Let the "signing you in" screen show for a beat — do not talk over it.',
    backend:
      'A GoHighLevel Custom Menu Link — it opens our URL with the sub-account id on the query string, the same shape BuildSuite\'s own menu link uses. One thing to know: GoHighLevel does not substitute merge fields in these links, so each sub-account needs its own link with its id written in. A Marketplace app removes that later.',
    ifAsked: [
      {
        q: 'Do our staff need separate accounts?',
        a: 'No. If they can get into GoHighLevel, they can get in here. Their access follows their sub-account.',
      },
    ],
  },

  {
    title: 'The sign-in moment',
    seconds: 45,
    screen: 'connecting',
    hotspot: 'spinner',
    hover: 'Nothing. Let it land on its own.',
    say: 'That pause is us checking with GoHighLevel that this really is your account before we show anything. It is the difference between a link that works and a link anyone could forward.',
    watch:
      'It is fast — if you blink past it, do not go back for it. Never say "loading"; say "verifying".',
    then: 'Land on the dashboard.',
    backend:
      'That id in the URL is a claim, not proof — it is plain text anyone could edit. So before issuing anything, we call the GoHighLevel API with our own credential and ask whether that sub-account is real and reachable by us. If GoHighLevel cannot be reached we refuse rather than let people through: an outage must not become an open door. The session is then a signed cookie, eight hours, http-only. Editing it to name a different company breaks the signature and it is rejected.',
  },

  {
    title: 'Contractor Dashboard — the morning view',
    seconds: 120,
    screen: 'dashboard',
    hotspot: 'attention',
    hover: 'Sweep the four tiles left to right, then rest on "Projects needing attention".',
    say: 'This is what your project manager opens with coffee. Active jobs, what they are worth, what is waiting on them. The panel underneath is the useful part — it is not a list of everything, it is a list of what has gone quiet or gone wrong. The system is telling them where to look.',
    watch:
      'Point at the shape, not the values. THIS SCREEN IS ON DEMO DATA — there is an amber "Demo data" banner across the top of it saying so, and the names are Johnson and Dana. Do not call these live numbers; the banner will contradict you while you speak. The live BuildSuite read is the "From BuildSuite" screen in the sidebar, and if they want to see real rows, go there.',
    then: 'Point at the badge on Field Updates in the sidebar, then open Projects.',
    backend:
      'This screen is on fixtures. It reads through our data layer, which falls back to sample data until GHL_PROJECT_OBJECT_KEY is set — and even once it is, that live path reads GoHighLevel custom objects, not Supabase. Two places touch BuildSuite\'s Supabase for real: the "From BuildSuite" screen, and the lookup at sign-in that works out which contractor you are. Where we do read it, the read-only guarantee is ours rather than the key\'s — the key is the publishable one and BuildSuite\'s tables have no row-level security, so what stops writes is that the database client we wrote exposes only select and count, both GET, and has no insert, update or delete method at all. Worth being precise about that distinction if the question comes from someone who owns the database.',
    ifAsked: [
      {
        q: 'Are these real numbers?',
        a: 'On this screen, no — that banner at the top says demo data and it means it. The live read is the "From BuildSuite" screen, which is your actual database, and sign-in resolves your real account against it too. I would rather tell you that than have you find it.',
      },
    ],
  },

  {
    title: 'Projects — and whose they are',
    seconds: 90,
    screen: 'projects',
    hotspot: 'row-1',
    hover: 'Run down the rows, then rest on the Johnson Kitchen row.',
    say: 'Every job, one row each. And these are yours only — the database has other contractors in it, and none of them appear here, and you do not appear in theirs. That is enforced where the data is read, not by hiding rows in the page.',
    watch:
      'This is a strong point but a short one. Do not oversell it into a security lecture — one sentence, then move.',
    then: 'Click into Johnson Kitchen Remodel.',
    backend:
      'Every staff-side read takes a tenant as its first argument and refuses to run without one, so an unscoped read does not compile rather than quietly returning everything. Two client-side reads deliberately take no tenant — a homeowner may have jobs with more than one contractor, so those are constrained by the gate instead; worth saying so if someone goes looking, because it is a deliberate exception rather than a miss. This is not theoretical: in August the live database had 43 projects across five contractors visible to any signed-in user, and that is what fixed it. The tenant is the GoHighLevel sub-account, and one sub-account can own several BuildSuite profiles — this agency has two, so we resolve both.',
  },

  {
    title: 'One project — everything in one record',
    seconds: 120,
    screen: 'project',
    hotspot: 'financials',
    hover: 'Rest on the financial panel — contract value, cost, margin.',
    say: 'One project, one record. Stage, schedule, the client, the crew, and the money — including your cost and your margin. Hold that thought, because that number is the reason the next screen exists.',
    watch:
      'Do not skip past the margin figure quickly, and do not apologise for it being on screen. You are setting up the payoff.',
    then: 'Click Client Visibility Settings, top right.',
  },

  {
    title: 'Client Visibility Settings',
    seconds: 180,
    screen: 'visibility',
    hotspot: 'switches',
    star: true,
    hover: 'Left panel, down the list of switches. Then move to the right panel.',
    say: 'This is the screen I most want you to see, because it is the one nobody else has. Every switch is a decision about what your homeowner is allowed to see. Schedule on. Budget off. Photos on. Messaging off. You decide per project, not per company. And the panel on the right is not a description of what should happen — it is the portal answering the question live. Change a switch, save, and it changes.',
    watch:
      'Actually toggle one and save it. A screen you only describe is a mockup; a screen you change in front of them is a product. Turn it back afterwards.',
    then: 'Move down to the "Never visible" panel.',
    backend:
      'Each switch is a field on the project record and a clause in the check that runs before any client response is assembled. The panel on the right is not a description of the result — it calls the same function the real portal calls, so it cannot show you something the portal would not actually do.',
    ifAsked: [
      {
        q: 'Can we set defaults instead of doing this per job?',
        a: 'Yes — that is a settings screen we have not built yet. The per-project control is the part that has to be right first.',
      },
    ],
  },

  {
    title: 'The things no switch can turn on',
    seconds: 90,
    screen: 'visibility',
    hotspot: 'never',
    star: true,
    hover: 'Rest on the "Never visible, whatever the switches say" panel.',
    say: 'And then there is this. Your cost, your markup, your margin, your internal notes, your supplier invoices. There is no switch for these, because we did not build one. They are removed before the page is built, not hidden on it. Nobody can misconfigure their way into showing a client their margin, and nobody can find it by poking around in the browser.',
    watch:
      'Say "we did not build a switch for it" rather than "it is disabled". The absence is the whole point.',
    then: 'Go to Field Updates in the sidebar.',
    backend:
      'Two different mechanisms, and the difference is the whole point. The switches are a deny-list: things you can turn off. Costs and margin use an allow-list — we name the fields a client may receive and build the response from only those. Deny-lists fail open, so a field someone forgets to add gets exposed. Allow-lists fail closed: a new field is invisible until somebody deliberately allows it. Add a margin column to the database tomorrow and it cannot reach a homeowner by accident.',
    ifAsked: [
      {
        q: 'What if we want a client to see costs on a cost-plus job?',
        a: 'Then that becomes a deliberate feature with its own control, not a switch that already exists and could be flipped by accident. Worth a conversation — it is a real model, it is just not this one.',
      },
    ],
  },

  {
    title: 'Field Updates — the queue',
    seconds: 90,
    screen: 'updates',
    hotspot: 'pending',
    hover: 'The badge on Field Updates in the sidebar, then the top pending card.',
    say: 'Your superintendent finishes on site and files an update from their phone. It arrives here. Notice what has not happened: your client has not been told anything. Nothing reaches them until someone decides it should.',
    watch: 'Make sure at least one update is actually pending before the call. If the queue is empty the next three steps have nothing to stand on.',
    then: 'Point at the red internal notes block on the pending update.',
    backend:
      'An update moves through a small state machine, and the state names matter: Pending, Approved Internally, Approved and Published. Only the last is visible to a client. Approved Internally reads like approval and deliberately is not — it is on the record for the contractor and nowhere else.',
  },

  {
    title: 'Two boxes — the whole argument',
    seconds: 180,
    screen: 'updates',
    hotspot: 'internal',
    star: true,
    hover: 'Rest on the red internal-notes block. Then drop to the client summary box below it.',
    say: 'Look at these two boxes. The red one is what the crew actually wrote — the tile came in wrong, the supplier let us down, we lost a day. The one below is what the client will read, and your PM can edit it before it goes. Same event. Two audiences. The crew never has to be diplomatic, and the client never reads a raw complaint about a supplier.',
    watch:
      'Read a line of the red text out loud. Actually type an edit into the client summary in front of them — this is the moment the call turns, and it turns on it being live rather than described.',
    then: 'Hover the three buttons, naming each.',
    backend:
      'Two separate fields on the record, not one field shown twice. No code path copies the internal note into the client summary; the summary is only ever what the PM typed. That is why the portal screen later can prove the supplier complaint was not sent — it was never in the field that gets published.',
    ifAsked: [
      {
        q: 'Does the crew see what the PM changed?',
        a: 'Not today. That is a fair ask and it is the kind of thing we would add once you are using it.',
      },
    ],
  },

  {
    title: 'Three ways to answer',
    seconds: 90,
    screen: 'updates',
    hotspot: 'publish',
    hover: 'Hover each button in turn: Approve and Publish, Approve Internally, Return for Revision.',
    say: 'Three choices. Publish it — the client gets the edited version. Approve it internally — it is on the record for you, the client never sees it. Or send it back to the crew for more detail. Most systems give you one button. The middle one is the one that matters, because plenty of a day is worth recording and not worth reporting.',
    watch: 'Do not click yet. Name all three first, then click Publish.',
    then: 'Click Approve and Publish.',
    backend:
      'Publishing runs a defined workflow — WF4 — rather than a handful of updates scattered through a button handler. The workflow is a pure function: given this state, here are the effects. Set the status, notify the contact, stamp the date. Something separate carries them out. So we can test exactly what a publish does without sending anyone a real notification, and adding an effect with no handler fails the build instead of silently doing nothing.',
  },

  {
    title: 'Now switch to their side',
    seconds: 60,
    screen: 'updates',
    hotspot: 'switcher',
    star: true,
    hover: 'Top right of the header — the "Viewing as" dropdown. Click it, choose Client Portal.',
    say: 'Now the good bit. I am going to become your customer — same browser, same session, just the other side of that gate we have been setting up.',
    watch:
      'An orange bar appears across the top saying you are viewing as someone else. Point at it and say plainly: this is a demo shortcut so I can show you both sides in one sitting; your homeowner gets their own login by email invitation. Say it before they ask, or it looks like a shortcut you were hoping they would not notice.',
    then: 'Land on the client portal.',
    backend:
      'It rewrites the session cookie and re-signs it, keeping your real identity inside so the trip back is exact. Two guards matter here: assuming the field view carries your own tenant keys and never the demo account\'s, because otherwise switching would show you another agency\'s jobs; and the client view carries no tenant key at all, because a client is scoped through their contact record rather than through an agency.',
    ifAsked: [
      {
        q: 'So the contractor can log in as the client?',
        a: 'Only in this demo build, and only so I can show you both views in one call. Real clients get their own invitation and their own password — that is the next thing we build.',
      },
    ],
  },

  {
    title: 'The Client Portal — what they counted',
    seconds: 120,
    screen: 'portal',
    hotspot: 'sidebar',
    star: true,
    hover: 'Run the mouse slowly down the whole left nav — all twelve items — before saying anything else.',
    say: 'Twelve screens. Timeline, schedule, daily updates, designs, budget, change orders, documents, photos, messages, issues, payments, completion. This is the part we got wrong last time — not the thinking behind it, the order we showed it to you in. You asked to see a client portal and we showed you a database. This is the portal.',
    watch:
      'Slow down here. Let the list be seen before you talk over it. This step is repairing the specific impression that we had built less than we had.',
    then: 'Move to the six-stage tracker at the top of the page.',
    backend:
      'Same database, same project record. Nothing was copied or duplicated to build this side — there is one project, and the two experiences are two projections of it. That is the reason they cannot drift out of sync with each other.',
  },

  {
    title: 'Their project, in their language',
    seconds: 120,
    screen: 'portalTimeline',
    hotspot: 'stage-4',
    hover: 'The highlighted current stage in the six-stage tracker.',
    say: 'Your pipeline has nineteen stages, because that is what running a job takes. Your homeowner sees six, because "Estimate in Development" and "Deposit Paid" are your business, not theirs. Same project, same record — translated. They can see where they are without you teaching them your process.',
    watch:
      'The six-stage grouping is our reading, not something you confirmed. Ask them here whether the six are right — it turns a presentation into a working session, and you need one of those.',
    then: 'Open Daily Updates in the portal nav.',
    backend:
      'Nineteen stages down to six is a lookup table, and a stage we do not recognise falls back to Planning rather than throwing. A client seeing a slightly early stage is confusing; a client seeing a crashed page is worse.',
    ifAsked: [
      {
        q: 'Can we change the six?',
        a: 'Yes, and we would rather you did. Tell us what a homeowner should see and we will map it.',
      },
    ],
  },

  {
    title: 'The same update — transformed',
    seconds: 120,
    screen: 'portalList',
    hotspot: 'item-1',
    star: true,
    hover: 'Rest on the top update — the one you just published.',
    say: 'There it is. The update we approved sixty seconds ago. Read it — it is the clean version your PM wrote. Now tell me where the supplier complaint went. It is not further down the page and it is not hidden behind anything. It was never sent. That is the difference between a portal that displays your data and a system that decides what your data becomes.',
    watch:
      'This is the closing argument of the whole call. Pause after "it was never sent" and let them fill the silence.',
    then: 'Open Documents.',
    backend:
      'This response went through four checks before it was built: is the portal switched on for this project, is this item marked client-visible, is it in a published state, and does this contact actually own this project. The first failure wins and the item is gone. Then the internal fields are stripped from whatever is left. It happens where the data is read, so there is no version of this page, no API call and no browser trick that returns the internal note.',
  },

  {
    title: 'Documents — proof by absence',
    seconds: 120,
    screen: 'portalList',
    hotspot: 'count',
    star: true,
    hover: 'The document count in the header, then down the list.',
    say: 'Four documents here. There are six on the project. The two missing ones are a supplier invoice and a photo of damaged goods — both marked internal. A list that showed you everything would prove nothing. This one is short on purpose, and that is the feature.',
    watch:
      'Have the real counts in your head before the call so the numbers you say match the screen. If they do not match, say the shape and skip the figures.',
    then: 'Click through Photos and Messages quickly.',
    backend:
      'Default-deny. An item is invisible unless something explicitly marks it visible, so a document uploaded and never reviewed does not reach a client just by sitting there. The failure mode is a homeowner asking why they cannot see something, which is a phone call. The other way round is a leak.',
  },

  {
    title: 'Photos and Messages',
    seconds: 90,
    screen: 'portalList',
    hover: 'Quick pass — click each nav item, do not linger.',
    say: 'Photos the same way — the crew shoots everything, the client sees what you approve. Messages in one thread, so the job does not live in someone’s text messages and vanish when they leave.',
    watch: 'Keep moving. You have made the argument; this is confirmation, not new material.',
    then: 'Click Designs and Selections.',
  },

  {
    title: 'What is not built yet',
    seconds: 90,
    screen: 'portalPlaceholder',
    hotspot: 'coming',
    star: true,
    hover: 'Rest on the "coming shortly" panel. Do not click away quickly.',
    say: 'I want to be straight with you about this one. Designs, budget, change orders and payments are designed and not yet built. They are in the navigation because your client should be able to see what is coming rather than hit a dead end. We are about two weeks from these being real, and the four already work in the contractor view.',
    watch:
      'Do not skip this screen and do not rush it. You lost trust by them discovering a gap themselves; you get it back by showing them one first. Give the two-week estimate only if you can stand behind it — otherwise say "we will come back to you with a date this week".',
    then: 'Switch back to your account with the Viewing as dropdown, then go to the field view.',
    ifAsked: [
      {
        q: 'Why show them at all if they are empty?',
        a: 'The alternative is a homeowner clicking a link and getting nothing, and deciding the whole thing is broken. The demo you liked does exactly the same on its warranty screen.',
      },
    ],
  },

  {
    title: 'The Field Interface',
    seconds: 120,
    screen: 'field',
    hotspot: 'internal',
    hover: 'Narrow the browser window first so it goes to phone width. Then the two note fields.',
    say: 'Last view — this is the crew, on a phone, standing in a driveway. Big targets, few fields, thirty seconds to file. And here are the same two boxes from the other end: what happened, and what the client should hear. The crew writes both. Your PM decides. That is the whole loop.',
    watch:
      'Resize the window before you switch, not after — watching a desktop layout squeeze down live looks unfinished.',
    then: 'Stop sharing detail. Move to the close.',
    backend:
      'The same submit runs WF3, which notifies the project manager and never the client. Worth saying plainly if it comes up: there is no code path from a field submission to a client notification. The only route to a homeowner is a PM pressing publish.',
  },

  {
    title: 'What is live and what is not',
    seconds: 120,
    screen: 'dashboard',
    hover: 'Nothing. Look at the camera, not the screen.',
    say: 'Before we finish, where this actually stands, and I want to be blunt about it. Sign-in through GoHighLevel is real and working against your live account. The "From BuildSuite" screen is reading your real database — those projects started as leads in GoHighLevel, went into BuildSuite to be bid, and we read them back out. Everything else you saw today ran on demo data, and the amber banner across the top was saying so the whole time. That is not a gap in the build; it is one configuration value and your team\u2019s sign-off on our tables. Two other things: when the project list does go live it will still show more than it should until we can filter to signed work only, and four portal screens are placeholders. Everything else is built.',
    watch:
      'Say this even if nobody asks. It is the step that decides whether they believe the rest, and it is the step that stops a surprise three weeks from now. The "shows more than it should" line is the one you will be tempted to drop — do not. Someone will count the rows against their own numbers eventually, and it is much better that they heard it here first.',
    then: 'Go into the asks.',
    backend:
      'If they want specifics: the app is Next.js on Vercel, reading BuildSuite\'s Supabase read-only and GoHighLevel over its API. Our own operational tables are written and not yet created — that is the sign-off we are asking for. 189 automated tests, and the ones that matter assert the rules rather than the screens. On the list being too broad, the detail is in the annex step "The two things we are waiting on" — jump there if they push.',
  },

  {
    title: 'The two asks',
    seconds: 120,
    screen: 'dashboard',
    hover: 'Nothing on screen. Have a note open with the two asks written down.',
    say: 'Two things from you. First, tell us whether those six client stages are the right six — you run these jobs, we do not. Second, we need your team to switch on the Hub tables in the database; we have written the change and we will not run it ourselves on a live system. Give us those two and the four remaining screens land next.',
    watch:
      'Two asks, not five. If you list everything you are blocked on it reads as a project in trouble rather than a project waiting on a decision.',
    then: 'Ask for the meeting.',
  },

  {
    title: 'Close',
    seconds: 60,
    screen: 'dashboard',
    hover: 'Stop screen share before the goodbyes, not after.',
    say: 'Last thing — you told us this felt backward, and you were right about what we showed you. What you have seen today is what we had built, in the order it should have been shown. Can we get thirty minutes with whoever runs your jobs day to day, so the next version is shaped by them rather than by us guessing?',
    watch:
      'Do not relitigate the last meeting beyond that one sentence. Concede it, name what changed, ask for the next thing.',
    then: 'Stop sharing. Send the follow-up within the hour, while they still remember the two boxes.',
  },

  // ──────────────────────────────────────────────────────────────────────────
  // ANNEX — how it works underneath.
  //
  // Not part of the run. Jump here when someone technical takes over the call,
  // and go back to where you were afterwards. These answer the questions that
  // decide whether a technical person trusts the thing, which is a different
  // job from the walkthrough and badly done inside it.
  // ──────────────────────────────────────────────────────────────────────────

  {
    title: 'How the three systems fit together',
    seconds: 150,
    screen: 'systems',
    hotspot: 'handoff',
    section: 'annex',
    hover: 'Trace the inbound arrow first, then the handoff arrow, then the sync-back coming back.',
    say: 'Three systems, each keeping what it is good at, and it is a loop rather than a line. Leads land in GoHighLevel — that is your CRM, your contacts, your messaging. They cross into BuildSuite to be estimated and bid. When one is signed, it hands back to GoHighLevel, which owns the job from then on. The Project Hub sits on top of all of it as the operational layer. Worth being precise about one thing: the projects you saw on the dashboard came out of BuildSuite, and BuildSuite got them from GoHighLevel in the first place. We are reading the far end of your own pipeline, not a separate list.',
    watch:
      'Get the direction right — it is GoHighLevel into BuildSuite first, then back again at signing. Saying it backwards makes it sound like we do not know where their data lives. Do not let this become a whiteboard session on integration patterns unless they ask for one.',
    then: 'Move to where the data actually lives.',
    backend:
      'The signing handoff is deliberately once and one-directional. Two systems both writing the same operational records is how you get a project in two states at the same time with no way to say which is right. So BuildSuite hands over at signing, GoHighLevel owns it from then on, and we read the stage back rather than writing it. Everything joins on one key — the BuildSuite project id — never on a name, an address or an email, because those get edited. The practical consequence for us right now is that we are reading whatever BuildSuite holds, which is broader than the set we actually want; narrowing it to signed work is the matching piece described two steps down.',
    ifAsked: [
      {
        q: 'Why not keep everything in BuildSuite?',
        a: 'Because the client-facing side and the crew side need GoHighLevel messaging, automations and contact records. Rebuilding those inside BuildSuite would be the bigger job.',
      },
    ],
  },

  {
    title: 'Where the data lives',
    seconds: 150,
    screen: 'systems',
    hotspot: 'hubtables',
    section: 'annex',
    hover: 'The two boxes at the bottom — their database on the left, ours on the right.',
    say: 'Two places, and the split matters. Your project data lives in BuildSuite’s database and we read it — we do not copy it, and we cannot write to it. The records this system creates itself, like daily updates and approvals, belong in our own tables. Those are written and reviewed and not yet created, because creating tables in a live production database is not something we will do on our own initiative.',
    watch:
      'This is where the ask in step 20 comes from. If they push on why it is not done yet, the answer is that we chose to wait, not that we forgot.',
    then: 'Move to the security model.',
    backend:
      'Our tables are prefixed hub_ and the migration is create-only — no ALTER, no DROP, nothing of BuildSuite’s touched. Two things it gets right that the existing schema does not: row-level security on by default so nothing is readable until a policy allows it, and both tenancy keys on every row so a row cannot be read without knowing whose it is. It needs running by someone holding the service-role key, which the application deliberately does not have. An app that can rewrite its own schema is a bad idea even when it is convenient.',
    ifAsked: [
      {
        q: 'Could you just use our existing tables?',
        a: 'We would have to add columns to live tables that other things depend on. Separate tables mean if you switch this off tomorrow, nothing of yours has changed.',
      },
    ],
  },

  {
    title: 'How we know who someone is',
    seconds: 150,
    screen: 'stack',
    hotspot: 'data',
    section: 'annex',
    hover: 'The data-layer box. Then point back at the top of the diagram.',
    say: 'Your team signs in through GoHighLevel — no second password, and access follows their sub-account. When the crew and your homeowners get accounts, those come by email invitation and they set their own password, because neither group has a GoHighLevel login. That is the next thing we build.',
    watch:
      'Be straight that the field and client logins are not built yet. The dropdown you used on the call is the stand-in, and pretending otherwise is exactly the kind of gap that caused the last problem.',
    then: 'Move to the gate.',
    backend:
      'Sessions are signed with a secret and verified before the contents are even parsed, so a tampered cookie is rejected rather than half-read. Eight-hour expiry, http-only. For invitations we would use Supabase Auth rather than writing password hashing, resets and lockout ourselves — that is code you do not want a small team owning. It also argues for the Hub having its own Supabase project, so our users are not sitting in BuildSuite’s auth table.',
  },

  {
    title: 'Why the gate is not a UI rule',
    seconds: 180,
    screen: 'stack',
    hotspot: 'gate',
    section: 'annex',
    star: true,
    hover: 'The gate box in the middle of the stack.',
    say: 'This is the part I would want to be asked about. Everything a client sees passes through one check, and it sits underneath the screens rather than inside them. Four questions: is the portal on for this project, is this item marked visible, has it been published, and does this person actually own this project. First failure wins. Then internal fields are stripped from whatever survived. If a screen forgets to hide something, the something was never in the response for it to forget.',
    watch:
      'The distinction to land: hiding in the interface means the data was sent and not drawn, which a browser can undo. This is removal before sending. If they only remember one technical thing, make it that.',
    then: 'Move to tenancy.',
    backend:
      'Two layers doing different jobs. The gate decides whether an item may cross at all. The projection then decides which fields go, and it is an allow-list — we name what a client may receive, so anything new is invisible until somebody deliberately allows it. There is also a structural guard: the enforcement modules are marked server-only, so if someone ever imports them into browser code the build fails rather than shipping the rules to the client. About two hundred automated tests, and the load-bearing ones assert these rules rather than the screens.',
    ifAsked: [
      {
        q: 'How do we know it works?',
        a: 'The tests are named after the rules they assert, so a failure names the rule that broke. And the demo fixtures include a deliberately withheld invoice and photo — a list that showed everything would prove nothing.',
      },
    ],
  },

  {
    title: 'How one agency cannot see another',
    seconds: 150,
    screen: 'stack',
    hotspot: 'src-1',
    section: 'annex',
    hover: 'The data-layer box, then the Supabase box underneath it.',
    say: 'Separately from what a client sees, there is the question of what another contractor sees. Every read is scoped to one sub-account, and the scope is a required argument rather than a filter somebody remembers to add. Leave it out and the code does not build.',
    watch:
      'Only bring up the August leak if they ask how you know. It is a strong answer to "how confident are you" and a bad answer to a question nobody asked.',
    then: 'Move to what happens when things break.',
    backend:
      'The tenant is the GoHighLevel sub-account, matching how BuildSuite does it, and one sub-account maps to several BuildSuite profiles — the agency you saw has two owning nine projects between them, so scoping to a single person would have hidden half their own work. An empty scope is refused outright rather than treated as "match nothing", because a silent empty result reads as "you have no projects" instead of "we failed to work out who you are".',
  },

  {
    title: 'When something breaks',
    seconds: 120,
    screen: 'systems',
    hotspot: 'hub',
    section: 'annex',
    hover: 'The Project Hub box, then the arrows into it.',
    say: 'Fair question to ask of anything that sits between three systems. If GoHighLevel is unreachable, sign-in refuses rather than letting people through — we would rather you cannot get in for ten minutes than have the door open. If BuildSuite is unreachable, you get an error that says so instead of an empty dashboard that looks like you have lost your projects. And nothing in this application writes to your data on a failure path, so a broken read never turns into damaged records.',
    watch:
      'Do not promise uptime numbers. Describe the failure behaviour, which is the thing you can actually stand behind.',
    then: 'Move to what is left to build.',
    backend:
      'Every failure names its own cause rather than showing one generic message, because an unhelpful error costs an afternoon of looking in the wrong place. A forged sign-in link and a GoHighLevel outage look similar from the outside and need completely different responses, so they are told apart by status code and reported separately.',
  },

  {
    title: 'What is left, honestly',
    seconds: 150,
    screen: 'stack',
    section: 'annex',
    hover: 'Nothing. This one is eye contact.',
    say: 'Four portal screens are designed and not built: designs and selections, budget, change orders and payments. Field and client logins are designed and not built. Our tables need creating in your database. Multi-tenant sign-in needs a GoHighLevel Marketplace app before the second client, not after. And two things we are waiting on from the BuildSuite side, which I will come to. Everything else you saw today is real and running.',
    watch:
      'Say this list the same way whether you are asked or not. It is the difference between a project with known gaps and a project with surprises. Do not name individuals on the client side of the call — "the BuildSuite side" is enough; the names belong in the internal note below.',
    then: 'Go to the two open dependencies.',
    backend:
      'The four screens are placeholders with real designs behind them rather than missing routes, so the navigation is honest about what is coming. Multi-tenant is the real dependency to flag: the token we authenticate with today is scoped to one sub-account, so a second client needs the Marketplace app. Worth doing before there is a second client rather than during.',
  },

  {
    title: 'The two things we are waiting on',
    seconds: 150,
    screen: 'systems',
    hotspot: 'inbound',
    section: 'annex',
    star: true,
    hover: 'The inbound arrow — leads coming into BuildSuite from GoHighLevel.',
    say: 'Two open dependencies, both on the BuildSuite side, and both about which projects we should be showing rather than how we show them. First, the dashboard is currently reading every project BuildSuite holds for the account. What it should show is only the closed, signed work — and that needs the client-to-contractor matching finished before we can filter on it. Second, we cannot identify how a contractor bid is classified in the data, so we cannot yet tell a won bid from an open one programmatically. Neither blocks anything you have seen today; both decide what the list contains.',
    watch:
      'INTERNAL DETAIL, do not say the names on a client call: the matching work is Sing’s, and the bid classification is the one Pat set up which we have not been able to locate in the schema. Externally these are "the BuildSuite side" and "how bids are classified".\n\nDo not let this get folded into the two asks in step 20. Those are decisions the client makes. These are things another team owes us, and mixing them makes the ask look longer than it is.',
    then: 'Go back to wherever you jumped in from.',
    backend:
      'Concretely: we read projects for the account and filter on active status, with no notion of "this deal was won". Until the matching lands there is no reliable join from a contractor to the client whose deal they closed, so "only closed deals" cannot be expressed as a query yet. The bid classification is the other half — we have gone through the columns and cannot find the field or value Pat used to mark a bid as won, so we are guessing at a filter we should be reading. Both are questions for the BuildSuite team rather than work we can do here, and neither is a reason to hold the four portal screens.',
    ifAsked: [
      {
        q: 'So the numbers on the dashboard are wrong?',
        a: 'They are real and they are that account’s, but the list is broader than it should be — it has work in it that is not signed yet. Narrowing it is the filter we are waiting on, not a rebuild.',
      },
    ],
  },
];
