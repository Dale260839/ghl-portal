import type { ScreenId } from './wireframes.ts';

/**
 * The client walkthrough, written to be read off a second monitor mid-call.
 *
 * Every screen reference here was checked against the running app — nav labels,
 * panel headings, button text, counts. The first draft was written from memory
 * and got several of them wrong, which is worse than useless when someone is
 * following it live in front of a client.
 *
 * Shaped by the meeting where the client called the system backward:
 *
 *   1. **Client portal early.** They counted screens. Thirteen nav items exist,
 *      so let them be seen rather than arriving twenty minutes in.
 *   2. **Prove the thing the demo they liked cannot do.** Any portal shows a
 *      homeowner a progress bar. Ours is the one where the contractor decides
 *      what crosses, and where an internal note provably does not.
 *
 * Steps 9-15 are that argument, told once, end to end. The honesty steps are
 * load-bearing: the trust problem came from a gap between what was said and
 * what was seen, and it does not close by widening it.
 */

export interface Step {
  /** Short title for the step list. */
  title: string;
  /** Planned seconds. */
  seconds: number;
  screen: ScreenId;
  /** Block id in that screen's map. Omit when the step is not about a place. */
  hotspot?: string;
  /** Where the mouse goes. Concrete — name the thing on screen. */
  hover: string;
  /** The words. Short sentences: say them, don't read them. */
  say: string;
  /** What goes wrong here. */
  watch?: string;
  /** The action that ends the step. */
  then: string;
  /** Objections that land on this step specifically. */
  ifAsked?: { q: string; a: string }[];
  /** The moments the call is for. */
  star?: boolean;
  /**
   * The one thing they should remember from this step.
   *
   * Sits at the top of the panel so a presenter who reads nothing else still
   * says the right sentence. Everything below it is elaboration.
   */
  primary: string;
  /** Steps where a wrong move costs something. Flagged in the sequence list. */
  risk?: boolean;
  /**
   * The client-friendly half of "under the hood" — what you say when a
   * non-technical person asks how it works. `backend` is the technical half.
   */
  hoodSimple?: string;
  /** Block ids to mark AVOID on the map: on screen, but not to be pointed at. */
  avoid?: string[];
  /**
   * What is happening server-side. **Not for reading out** — it is for when
   * someone technical asks where the data comes from, which is a question you
   * answer badly if you improvise it.
   */
  backend?: string;
  /** `annex` steps sit outside the timed run — architecture answers on demand. */
  section?: 'walkthrough' | 'annex';
}

/** The timed walkthrough — the annex is excluded. */
export function walkthroughSteps(steps: Step[] = STEPS): Step[] {
  return steps.filter((s) => s.section !== 'annex');
}

export const TITLE = 'BuildSuite Project Hub';
export const SUBTITLE = 'client walkthrough · second screen only — not the shared one';

export const STEPS: Step[] = [
  {
    title: 'Before you share',
    risk: true,
    primary:
      'Set the stage so nothing embarrassing is on screen when you hit share.',
    seconds: 45,
    screen: 'signin',
    hover: 'Nothing yet. Hands off until the share starts.',
    say: 'Thanks for the time. Last time we showed you the plumbing before the product. Today we go the other way: what your homeowner sees first, then the control you have over it. Forty minutes, stop me whenever.',
    watch:
      'This HUD goes on the OTHER screen. Close Slack and email. Have GoHighLevel open and logged into the Alliance sub-account, and a second tab already on the Hub dashboard. Browser at 110%.\n\nThe clock counts talking time only — with questions this runs closer to an hour. If they only have twenty minutes, do the eight starred steps.',
    then: 'Share the screen. Go to GoHighLevel.',
  },

  {
    title: 'It lives inside GoHighLevel',
    primary:
      'It lives inside the tool your team already uses — no new login, no new habit.',
    hoodSimple:
      'It\'s a menu item inside GoHighLevel that opens the Hub already signed in as your company.',
    seconds: 75,
    screen: 'systems',
    hotspot: 'ghl',
    hover: 'The Project Hub item in the GoHighLevel left menu. Hover it, do not click yet.',
    say: 'Nothing new to log into. The Project Hub is an item in the same left menu your team already uses. One click, no second password.',
    watch:
      'Be in the Alliance sub-account before you click. If the menu item is not there, go straight to the Hub tab and say the menu link is a GoHighLevel setting we hand over at the end — do not hunt for it live.',
    then: 'Click it. Let the "signing you in" screen sit for a beat.',
    backend:
      "A GoHighLevel Custom Menu Link, opening our URL with the sub-account id on the query string — the same shape BuildSuite's own menu link uses. GoHighLevel does not substitute merge fields in these links, so each sub-account needs its own link with the id written in. A Marketplace app removes that later.",
    ifAsked: [
      {
        q: 'Do our staff need separate accounts?',
        a: 'No. If they can get into GoHighLevel, they can get in here.',
      },
    ],
  },

  {
    title: 'The sign-in check',
    primary:
      'We verify with GoHighLevel that it\'s really your account before showing a single row.',
    hoodSimple:
      'Before showing anything, we ask GoHighLevel to confirm the account is real and ours to serve. If we can\'t reach them, we refuse rather than let someone through.',
    seconds: 40,
    screen: 'signin',
    hover: 'Nothing. Let it land on its own.',
    say: 'That pause is us asking GoHighLevel whether this really is your account, before we show anything. It is the difference between a link that works and a link anyone could forward.',
    watch: 'It is quick. If you miss it, do not go back for it. Say "verifying", never "loading".',
    then: 'Land on the dashboard.',
    backend:
      'The id in the URL is a claim, not proof — plain text anyone could edit. So we call the GoHighLevel API with our own credential and ask whether that sub-account is real and reachable by us. If GoHighLevel is unreachable we refuse rather than let people through: an outage must not become an open door. The session is a signed cookie, eight hours, http-only; editing it to name another company breaks the signature.',
  },

  {
    title: 'The contractor dashboard',
    risk: true,
    primary:
      'The whole company\'s pulse in one screen, instead of five tools and a spreadsheet.',
    hoodSimple:
      'The dashboard reads the project data straight from the database, so there\'s no second copy of the numbers to keep in sync.',
    seconds: 100,
    screen: 'dashboard',
    hotspot: 'sec-projects-needing-attention',
    hover:
      'Four tiles across the top — Active contract value, Outstanding balance, Updates awaiting review, Needs attention. Sweep them, then rest on the "Projects needing attention" panel below.',
    say: 'What your PM opens with coffee. The four tiles are the money and the queue. The panel underneath is the useful part — not a list of everything, a list of what has gone quiet or gone wrong.',
    watch:
      'THIS SCREEN IS ON DEMO DATA. An amber "Demo data" banner sits across the top saying so, and the names are Johnson and Whitfield. Do not call these live numbers — the banner contradicts you while you speak. Point at the shape, not the figures.',
    then: 'Point at the "2" badge on Field Updates in the sidebar. Then open Projects.',
    backend:
      "Fixtures. This screen reads through our data layer, which falls back to sample data until GHL_PROJECT_OBJECT_KEY is set — and even once set, that live path reads GoHighLevel custom objects, not Supabase. Two things touch BuildSuite's Supabase for real: the \"From BuildSuite\" screen, and the profile lookup at sign-in.",
    ifAsked: [
      {
        q: 'Is this our real data?',
        a: 'Not on this screen — that banner says demo data and it means it. The live one is "From BuildSuite" in the sidebar, and sign-in resolves your real account too. I would rather tell you than have you find it.',
      },
    ],
  },

  {
    title: 'Projects — and whose they are',
    primary:
      'You see your jobs and nobody else\'s — enforced in the data, not hidden in the page.',
    hoodSimple:
      'Every request carries who you are, and the database only returns rows belonging to your company. Other contractors are in the same system and never appear here.',
    seconds: 70,
    screen: 'projects',
    hotspot: 'title',
    hover: 'Down the project rows. Rest on Johnson Kitchen Remodel.',
    say: 'Every job, one row each. And these are yours only. The database has other contractors in it; none of them appear here, and you do not appear in theirs.',
    watch: 'One sentence on scoping, then move. Do not turn it into a security lecture.',
    then: 'Click into Johnson Kitchen Remodel.',
    backend:
      'Every staff-side read takes a tenant as its first argument and will not compile without one. Not theoretical — in August the live database had 43 projects across five contractors visible to any signed-in user, and this is what fixed it. Two client-side reads deliberately take no tenant, because a homeowner may have jobs with more than one contractor; those are constrained by the gate instead.',
  },

  {
    title: 'One project, one record',
    primary:
      'One record holds the whole job — including the money the client must never see.',
    hoodSimple:
      'Everything about a job lives on one record, so the crew, the office and the homeowner are all looking at the same source rather than their own copies.',
    seconds: 90,
    screen: 'project',
    hotspot: 'sec-financials',
    hover:
      'Five panels down the page — Timeline, Field updates, Financials, Client visibility, Assigned team. Rest on Financials.',
    say: 'One record holds the whole job. Stage, updates, the crew, and the money — including your cost and your margin. Hold that thought, because it is why the next screen exists.',
    watch:
      'Do not rush past the margin figure and do not apologise for it being on screen. You are setting up the payoff.',
    then: 'Scroll to the "Client visibility" panel and click "Edit visibility →".',
  },

  {
    title: 'Client Visibility Settings',
    primary:
      'You decide, switch by switch, what your homeowner is allowed to see — per project.',
    hoodSimple:
      'Each switch is stored on the project and checked every time the client portal builds a page. The preview panel runs the same check the real portal does, so it can\'t promise something the portal wouldn\'t do.',
    seconds: 160,
    screen: 'visibility',
    hotspot: 'sec-switches',
    star: true,
    hover: 'The Switches panel on the left. Then move right to "What the client actually gets".',
    say: 'This is the screen nobody else has. Every switch is a decision about what your homeowner may see. Schedule on. Budget off. Photos on. Per project, not per company. And the panel on the right is not a description — it is the portal answering live. Flip a switch, save, it changes.',
    watch:
      'Actually toggle one and press "Save visibility". A screen you describe is a mockup; a screen you change in front of them is a product. Turn it back afterwards.',
    then: 'Scroll to the "Never visible" panel.',
    backend:
      'Each switch is a field on the project record and a clause in the check that runs before any client response is assembled. The right-hand panel calls the same function the real portal calls, so it cannot show something the portal would not do.',
    ifAsked: [
      {
        q: 'Can we set defaults instead of doing this per job?',
        a: 'Not yet — that is a settings screen we have not built. Per-project control had to be right first.',
      },
    ],
  },

  {
    title: 'What no switch can turn on',
    primary:
      'Cost, markup and margin have no switch at all — they\'re removed before the page is built.',
    hoodSimple:
      'For the sensitive fields we don\'t rely on a setting being off. We build the client\'s page from a named list of allowed fields, so anything not on that list can\'t appear even by mistake.',
    seconds: 80,
    screen: 'visibility',
    hotspot: 'sec-never-visible-whatever-the-switches-',
    star: true,
    hover: 'The panel headed "Never visible, whatever the switches say".',
    say: 'Then there is this. Your cost, your markup, your margin, your internal notes, supplier invoices. There is no switch for these, because we did not build one. They are removed before the page is built, not hidden on it. Nobody can misconfigure their way into showing a client their margin.',
    watch: 'Say "we did not build a switch for it", not "it is disabled". The absence is the point.',
    then: 'Go to Field Updates in the sidebar.',
    backend:
      'Two mechanisms, and the difference is the point. The switches are a deny-list: things you can turn off. Costs and margin use an allow-list — we name the fields a client may receive and build the response from only those. Deny-lists fail open, so a field someone forgets gets exposed. Allow-lists fail closed: a new field is invisible until somebody deliberately allows it.',
    ifAsked: [
      {
        q: 'What about a cost-plus job where the client should see costs?',
        a: 'Then that becomes a deliberate feature with its own control, not a switch sitting there waiting to be flipped by accident. Worth a conversation.',
      },
    ],
  },

  {
    title: 'The review queue',
    risk: true,
    primary:
      'Nothing reaches your client until a human decides it should.',
    hoodSimple:
      'A field update arrives in a pending state. Nothing is sent to the homeowner until someone approves and publishes it.',
    seconds: 70,
    screen: 'updates',
    hotspot: 'sec-johnson-kitchen-remodel',
    hover: 'The two pending cards — Johnson Kitchen Remodel and Whitfield Master Suite Addition.',
    say: 'Your superintendent files an update from their phone on site. It arrives here. Notice what has not happened: your client has not been told anything.',
    watch:
      'There must be at least one pending update before the call, or the next three steps have nothing to stand on. Two are seeded — check they are still there.',
    then: 'On the Johnson card, point at the red internal notes block.',
    backend:
      'An update moves through a small state machine and the names matter: Pending, Approved Internally, Approved & Published. Only the last is visible to a client. Approved Internally reads like approval and deliberately is not.',
  },

  {
    title: 'Two boxes — the argument',
    primary:
      'The crew writes what happened; the PM writes what the client reads. Same event, two audiences.',
    hoodSimple:
      'They\'re two separate fields on the record. Nothing copies the internal note into the client\'s version — which is why it can\'t leak later.',
    seconds: 150,
    screen: 'updates',
    hotspot: 'sec-johnson-kitchen-remodel',
    star: true,
    hover: 'The red internal-notes block, then the client summary box under it.',
    say: 'Two boxes. The red one is what the crew wrote — the tile came in wrong, the supplier let us down, we lost a day. The one below is what the client reads, and your PM edits it before it goes. Same event, two audiences. The crew never has to be diplomatic; the client never reads a raw complaint about a supplier.',
    watch:
      'Read a line of the red text out loud. Then actually type an edit into the client summary. This is where the call turns, and it turns on it being live rather than described.',
    then: 'Move to the four buttons underneath.',
    backend:
      'Two separate fields on the record, not one field shown twice. No code path copies the internal note into the client summary. That is why the portal screen later can prove the complaint was not sent — it was never in the field that gets published.',
    ifAsked: [
      {
        q: 'Does the crew see what the PM changed?',
        a: 'Not today. Fair ask, and the kind of thing we would add once you are using it.',
      },
    ],
  },

  {
    title: 'Four ways to answer',
    primary:
      'Approve internally is the button nobody else gives you — recorded, not reported.',
    hoodSimple:
      'Publishing runs a defined workflow rather than ad-hoc updates: it sets the status, notifies the client and stamps the date as one unit, so it can\'t half-happen.',
    seconds: 80,
    screen: 'updates',
    hotspot: 'btn-approve-and-publish',
    hover:
      'The four buttons on the card — Approve and Publish, Approve Internally, Edit Client Summary, Return for Revision.',
    say: 'Four choices. Publish it and the client gets the edited version. Approve internally and it is on your record but the client never sees it. Edit the summary first. Or send it back to the crew. Most systems give you one button. The second one matters most — plenty of a day is worth recording and not worth reporting.',
    watch: 'Name all four before clicking anything. Then click Approve and Publish.',
    then: 'Click Approve and Publish.',
    backend:
      'Publishing runs a defined workflow, WF4, rather than updates scattered through a button handler. The workflow is a pure function: given this state, here are the effects — set the status, notify the contact, stamp the date. Something else carries them out, so we can test what a publish does without sending anyone a real notification, and an effect with no handler fails the build.',
  },

  {
    title: 'Switch to their side',
    risk: true,
    primary:
      'Same browser, other side of the gate — say out loud that this is a demo shortcut.',
    hoodSimple:
      'It swaps the signed-in view to the client\'s, keeping your real identity underneath so you can switch back. Real clients will get their own invited login.',
    seconds: 55,
    screen: 'updates',
    hotspot: 'switcher',
    star: true,
    hover: 'Top right of the header — "Viewing as Contractor". Click it, choose Client Portal.',
    say: 'Now I am going to become your customer. Same browser, other side of the gate.',
    watch:
      'An orange bar appears saying you are viewing as someone else. Point at it and say it before they ask: this is a demo shortcut so I can show both sides in one sitting, and your homeowner gets their own login by email invitation. Announced, it reads as considered. Discovered, it reads as a hole.',
    then: 'Land on the client portal.',
    backend:
      "It rewrites and re-signs the session cookie, keeping your real identity inside so the return trip is exact. Two guards: the field view inherits your own tenant keys and never the demo account's, or a switch would show you another agency's jobs; and the client view carries no tenant key at all, because a client is scoped through their contact record.",
    ifAsked: [
      {
        q: 'So a contractor can log in as their client?',
        a: 'Only in this demo build, so I can show you both views in one call. Real clients get their own invitation and password — that is the next thing we build.',
      },
    ],
  },

  {
    title: 'Thirteen screens',
    primary:
      'Thirteen screens — this is the client portal you asked to see last time.',
    hoodSimple:
      'Every nav item is a real route; four of them are designed placeholders and I\'ll show you one.',
    seconds: 100,
    screen: 'portal',
    hotspot: 'nav-completion-warranty',
    star: true,
    hover:
      'Run slowly down the whole left nav — all thirteen, ending on Completion & Warranty. Say nothing until you reach the bottom.',
    say: 'Thirteen screens. Timeline, schedule, daily updates, designs, budget, change orders, documents, photos, messages, issues, payments, completion. This is what we got wrong last time — not the thinking, the order we showed it in. You asked to see a client portal and we showed you a database.',
    watch:
      'Slow down here. Let the list be seen before you talk over it. This step exists to repair one specific impression: that we had built less than we had.',
    then: 'Move to the top of the page.',
  },

  {
    title: 'Their project, their language',
    primary:
      'Your nineteen pipeline stages become plain English for the homeowner.',
    hoodSimple:
      'The same project record is translated for the client: your detailed stages collapse into a handful they\'d actually understand.',
    seconds: 90,
    screen: 'portal',
    hotspot: 'title',
    hover:
      'The project name at the top, then the "Your input is needed" card, then "Current stage — In Progress".',
    say: 'Their job, in their words. Where it is now, what needs them next, what is coming. Your pipeline has nineteen stages because running a job takes nineteen. They see the one that matters, in plain English. Same record, translated.',
    watch:
      'There are two Johnson projects in the switcher at the top — a homeowner can have more than one job with you. Worth a sentence if they notice it.',
    then: 'Open Daily Updates in the nav.',
    backend:
      'Nineteen stages collapse to six for the client via a lookup table; an unrecognised stage falls back to Planning rather than throwing. A client seeing a slightly early stage is confusing; a crashed page is worse. The six are our reading, not something anyone confirmed — worth asking them.',
    ifAsked: [
      {
        q: 'Can we change what the stages are called?',
        a: 'Yes, and we would rather you did. Tell us what a homeowner should see and we will map it.',
      },
    ],
  },

  {
    title: 'The same update, transformed',
    primary:
      'The supplier complaint isn\'t hidden here — it was never sent.',
    hoodSimple:
      'Before this page is built we check the portal is on, the item is marked client-visible, it\'s been published, and this homeowner owns the project. Then internal fields are stripped from what\'s left.',
    seconds: 110,
    screen: 'portalUpdates',
    hotspot: 'title',
    star: true,
    hover: 'The top entry — the update you published two minutes ago.',
    say: 'There it is. The update we approved a minute ago, in the clean version your PM wrote. Now tell me where the supplier complaint went. It is not further down and it is not hidden behind anything. It was never sent.',
    watch:
      'This is the closing argument. Pause after "it was never sent" and let them fill the silence.',
    then: 'Open Documents.',
    backend:
      'Four checks ran before this response was built: is the portal on for this project, is the item client-visible, is it in a published state, does this contact own this project. First failure wins. Then internal fields are stripped from what is left. It happens where the data is read, so no page, no API call and no browser trick returns the internal note.',
  },

  {
    title: 'Documents — proof by absence',
    risk: true,
    primary:
      'The list is short on purpose — that\'s the feature, not a gap.',
    hoodSimple:
      'Nothing is visible unless it\'s explicitly marked visible, so a document uploaded and never reviewed can\'t reach a client by sitting there.',
    seconds: 100,
    screen: 'portalDocuments',
    hotspot: 'title',
    star: true,
    hover: 'The Document Center list. Count the rows out loud if it helps.',
    say: 'Five documents here. There are six on the project. The missing one is a supplier invoice, marked internal. A list that showed you everything would prove nothing — this one is short on purpose, and that is the feature.',
    watch:
      'Five of six is what the fixtures hold today. Count the rows on screen before the call and use the real number, or describe the shape and skip the figures.',
    then: 'Click Photos & Videos.',
    backend:
      'Default-deny. An item is invisible unless something explicitly marks it visible, so a document uploaded and never reviewed does not reach a client by sitting there. The failure mode is a homeowner asking why they cannot see something, which is a phone call. The other way round is a leak.',
  },

  {
    title: 'Photos, and the one held back',
    primary:
      'You decide when a problem becomes a conversation — not the system.',
    hoodSimple:
      'Same rule as documents: the crew shoots everything, the client sees what\'s been approved.',
    seconds: 70,
    screen: 'portalPhotos',
    hotspot: 'title',
    hover: 'The photo grid.',
    say: 'Same rule. Three photos published, four on the job. The held-back one is a scratched door with a replacement already ordered — your call whether that is a conversation you want before it is fixed, rather than the system deciding for you.',
    watch: 'Keep it short. You have made the argument; this is confirmation.',
    then: 'Click Designs & Selections.',
  },

  {
    title: 'What is not built yet',
    risk: true,
    primary:
      'Show them a gap before they find one — it buys more trust than a flawless pitch.',
    hoodSimple:
      'These are real routes with the design in place, waiting on the data layer. A client clicking a dead link concludes the product is broken; this tells them what\'s coming.',
    seconds: 85,
    screen: 'portalDesigns',
    hotspot: 'title',
    star: true,
    hover: 'The "coming shortly" panel. Do not click away quickly.',
    say: 'Straight with you on this one. Designs, budget, change orders and payments are designed and not built. They are in the navigation because your client should see what is coming rather than hit a dead end. Roughly two weeks.',
    watch:
      'Do not skip this and do not rush it. You lost trust by them finding a gap themselves; you get it back by showing them one first. Only give the two-week estimate if you can stand behind it.',
    then: 'Switch back to your account. Narrow the window, then go to the field view.',
    ifAsked: [
      {
        q: 'Why show them at all if they are empty?',
        a: 'The alternative is a homeowner clicking a link, getting nothing, and deciding the product is broken. The demo you liked does the same on its warranty screen.',
      },
    ],
  },

  {
    title: 'The field interface',
    primary:
      'Thirty seconds on a phone in a driveway — and the same two boxes from the other end.',
    hoodSimple:
      'Submitting notifies the project manager and never the client. There\'s no path from the crew\'s phone to your homeowner.',
    seconds: 90,
    screen: 'field',
    hotspot: 'sec-add-daily-update',
    hover:
      'Narrow the browser to phone width FIRST. Then: Today\'s tasks, the "Add daily update" form, and "Submit to Project Manager" at the bottom.',
    say: 'The crew, on a phone, in a driveway. Big targets, few fields, thirty seconds to file. And the same two boxes from the other end: what happened, and what the client should hear. The crew writes both, your PM decides. That is the loop.',
    watch:
      'Resize before you switch, not after. Watching a desktop layout squeeze down live looks unfinished.',
    then: 'Stop navigating. Move to the close.',
    backend:
      'Submitting runs WF3, which notifies the project manager and never the client. There is no code path from a field submission to a client notification. The only route to a homeowner is a PM pressing publish.',
  },

  {
    title: 'What is live, what is not',
    risk: true,
    primary:
      'Be blunt about what\'s real. It decides whether they believe everything else.',
    hoodSimple:
      'Sign-in and this screen read your live systems. The rest runs on sample content until our tables are created in your database.',
    seconds: 110,
    screen: 'buildsuite',
    hotspot: 'sec-active-projects',
    star: true,
    hover: 'Open "From BuildSuite" in the sidebar. This one IS your live data — show it.',
    say: 'Where this stands, bluntly. Sign-in through GoHighLevel is real, against your live account. This screen is reading your real BuildSuite database — those projects started as leads in GoHighLevel, went into BuildSuite to be bid, and we read them back out. Everything else today ran on demo data, and the amber banner said so the whole time. That is one configuration value and your team\'s sign-off on our tables, not a gap in the build.',
    watch:
      'Say this even if nobody asks — it decides whether they believe the rest. Ending on the live screen rather than a fixture screen is deliberate: finish on something real.',
    then: 'Go into the asks.',
    backend:
      "Next.js on Vercel, reading BuildSuite's Supabase read-only and GoHighLevel over its API. Our own tables are written and not yet created — that is the sign-off. 189 automated tests, and the ones that matter assert the rules rather than the screens.",
  },

  {
    title: 'The two asks',
    primary:
      'Two asks, not five. A short list reads as a project waiting on a decision.',
    hoodSimple:
      'We need the client stages confirmed by someone who runs jobs, and their team to create our tables.',
    seconds: 100,
    screen: 'buildsuite',
    hover: 'Nothing on screen. Have the two asks written down in front of you.',
    say: 'Two things from you. First: are those six client stages the right six? You run these jobs, we do not. Second: we need your team to create the Hub tables in the database. We have written the change and we will not run it ourselves on a live system. Give us those and the four remaining screens land next.',
    watch:
      'Two asks, not five. Listing everything you are blocked on reads as a project in trouble rather than one waiting on a decision. The BuildSuite-side dependencies are NOT asks — keep them in the annex.',
    then: 'Ask for the next meeting.',
  },

  {
    title: 'Close',
    primary:
      'Concede the last meeting in one sentence, then ask for the next thing.',
    hoodSimple:
      'Ask for time with whoever runs jobs day to day.',
    seconds: 50,
    screen: 'buildsuite',
    hover: 'Stop the screen share before the goodbyes, not after.',
    say: 'Last thing. You told us this felt backward, and you were right about what we showed you. What you saw today is what we had built, in the order it should have been shown. Can we get thirty minutes with whoever runs your jobs day to day, so the next version is shaped by them rather than by us guessing?',
    watch:
      'Concede in one sentence, name what changed, ask for the next thing. Do not relitigate the last meeting.',
    then: 'Stop sharing. Follow up within the hour, while they still remember the two boxes.',
  },

  // ── Annex — architecture answers, outside the timed run ───────────────────

  {
    title: 'How the three systems fit',
    primary:
      'A loop, not a line — and we\'re reading the far end of their own pipeline.',
    hoodSimple:
      'Leads start in GoHighLevel, cross into BuildSuite to be bid, and hand back to GoHighLevel at signing. The Hub sits on top of all three.',
    seconds: 100,
    screen: 'systems',
    hotspot: 'inbound',
    section: 'annex',
    hover: 'The inbound arrow first, then the handoff, then the sync-back.',
    say: 'A loop, not a line. Leads land in GoHighLevel — your CRM, contacts, messaging. They cross into BuildSuite to be estimated and bid. When one signs, it hands back to GoHighLevel, which owns the job from then on. The Hub is the operational layer on top. The projects you saw came out of BuildSuite, and BuildSuite got them from GoHighLevel. We are reading the far end of your own pipeline.',
    watch:
      'Get the direction right — GoHighLevel into BuildSuite first, then back at signing. Backwards makes it sound like we do not know where their data lives.',
    then: 'Back to wherever you jumped in from.',
    backend:
      'The signing handoff is once and one-directional. Two systems writing the same operational records is how you get a project in two states with no way to say which is right. Everything joins on one key, the BuildSuite project id — never a name, address or email, because those get edited.',
  },

  {
    title: 'Where the data lives',
    primary:
      'We hold nothing they can\'t see, and we haven\'t touched their database.',
    hoodSimple:
      'Contacts and messaging stay in GoHighLevel, estimates in BuildSuite. Our own tables are written and waiting for their team to create them.',
    seconds: 90,
    screen: 'stack',
    hotspot: 'data',
    section: 'annex',
    hover: 'The layers, bottom to top.',
    say: 'Three stores. GoHighLevel holds contacts, the pipeline and messaging. BuildSuite holds estimates and the project record. Our own operational tables — updates, approvals, visibility — are written and waiting on your team to create them. We hold nothing you cannot see.',
    then: 'Back to wherever you jumped in from.',
    backend:
      "Eight new tables, all prefixed hub_, create-only: no ALTER, no DROP, nothing of BuildSuite's touched. RLS enabled deny-by-default on every one, and both tenancy keys on every row, so a row cannot be read without knowing whose it is. Not run: the app's key cannot execute DDL, which is correct — a running application should never be able to change its own schema. It needs the service role and Sing's sign-off, since it is his database.",
  },

  {
    title: 'Why the gate is not a UI rule',
    primary:
      'It was never sent to their browser — not merely hidden in the page.',
    hoodSimple:
      'Most systems hide sensitive fields in the page, where a curious person can still find them. We remove them one layer below every screen, so they never leave the server.',
    seconds: 90,
    screen: 'stack',
    hotspot: 'gate',
    section: 'annex',
    star: true,
    hover: 'The gate layer in the middle.',
    say: 'The usual way to build this is to hide things in the page. We do it where the data is read, one layer below every screen. So there is no page, no export, no API call and no browser trick that returns what the gate removed. It is not that the client cannot see it — it was never sent to their browser.',
    then: 'Back to wherever you jumped in from.',
    backend:
      "Four clauses, first failure wins, then internal fields are stripped from what survives. Anywhere that assembles a client response without calling both is a defect even if the UI happens to hide it — that rule is in the repo's contributing notes, with tests asserting it.",
  },

  {
    title: 'How one agency cannot see another',
    primary:
      'Code that forgets to scope a query doesn\'t build.',
    hoodSimple:
      'Every request carries who you are, and reads that don\'t include it fail at build time rather than quietly returning everyone\'s data.',
    seconds: 80,
    screen: 'stack',
    hotspot: 'data',
    section: 'annex',
    hover: 'The data layer.',
    say: 'Every staff-side read takes the tenant as its first argument and will not compile without one. Not a filter someone remembers to add — code that forgets it does not build.',
    watch:
      'If they ask whether this was ever wrong: yes, and say so. In August we found 43 projects across five contractors visible to any signed-in user. Finding it is the reason it is now structural.',
    then: 'Back to wherever you jumped in from.',
    backend:
      "The tenant is the GoHighLevel sub-account, matching how BuildSuite works. One location maps to several BuildSuite profiles — the live Alliance account has two admin profiles owning nine projects between them, so scoping to one would have hidden half an agency's work from itself.",
  },

  {
    title: 'When something breaks',
    primary:
      'An outage must never become an open door.',
    hoodSimple:
      'If GoHighLevel can\'t be reached at sign-in we refuse rather than guess. If our app is down, their other systems carry on — nothing is stored only with us.',
    seconds: 80,
    screen: 'systems',
    hotspot: 'hub',
    section: 'annex',
    hover: 'The Project Hub box.',
    say: 'If GoHighLevel is unreachable at sign-in, we refuse rather than let people in — an outage must not become an open door. If our app is down, GoHighLevel and BuildSuite carry on; nothing depends on us to keep working, and nothing is stored only here.',
    then: 'Back to wherever you jumped in from.',
    backend:
      'Auth failures are classified rather than lumped together: an unknown sub-account, a bad credential of ours, and GoHighLevel being unreachable produce three different messages, because they need three different fixes. Measured against the live API — an unreachable location returns 403, not 404, which we had wrong at first, and it sent people off to check their wifi.',
  },

  {
    title: 'What is left',
    risk: true,
    primary:
      'The known gaps, said the same way whether they ask or not.',
    hoodSimple:
      'Four portal screens, the field and client logins, our tables, and multi-company sign-in before the second client.',
    seconds: 100,
    screen: 'stack',
    section: 'annex',
    hover: 'Nothing. Eye contact.',
    say: 'Four portal screens designed and not built: designs, budget, change orders, payments. Field and client logins designed and not built. Our tables need creating in your database. Multi-tenant sign-in needs a GoHighLevel Marketplace app before the second client, not after. Two more things we are waiting on from the BuildSuite side. Everything else is real.',
    watch:
      'Say this list the same way whether asked or not. Do not name individuals to the client — "the BuildSuite side" is enough.',
    then: 'Go to the two dependencies.',
    backend:
      'The four screens are placeholders with designs behind them, not missing routes, so the nav is honest about what is coming. Multi-tenant is the real dependency: the token we authenticate with is scoped to one sub-account, so a second client needs the Marketplace app.',
  },

  {
    title: 'The two we are waiting on',
    risk: true,
    primary:
      'These decide which projects appear — and they\'re owed by another team, not by us.',
    hoodSimple:
      'We\'re showing every project on the account because we can\'t yet tell which deals were actually won. That needs two pieces from the BuildSuite side.',
    seconds: 110,
    screen: 'systems',
    hotspot: 'inbound',
    section: 'annex',
    star: true,
    hover: 'The inbound arrow — leads coming into BuildSuite from GoHighLevel.',
    say: 'Two open dependencies, both on the BuildSuite side, both about which projects we show rather than how. First, the list reads every project BuildSuite holds for the account; it should show only closed, signed work, and that needs the client-to-contractor matching finished before we can filter on it. Second, we cannot find how a contractor bid is classified in the data, so we cannot yet tell a won bid from an open one. Neither blocks a screen. Both decide what the list contains.',
    watch:
      'INTERNAL — do not say these names to the client: the matching is Sing\'s, and the bid classification is the one Pat set up that we cannot locate in the schema. Externally: "the BuildSuite side" and "how bids are classified".\n\nKeep these out of the two asks. Those are the client\'s decisions; these are things another team owes us.',
    then: 'Back to wherever you jumped in from.',
    backend:
      'We read projects for the account filtered on active status, with no notion of "this deal was won". Until the matching lands there is no reliable join from a contractor to the client whose deal they closed, so "only closed deals" cannot be expressed as a query. We have been through the columns and cannot find the field or value marking a bid as won, so any filter would be a guess.',
    ifAsked: [
      {
        q: 'So the dashboard numbers are wrong?',
        a: "They are that account's, but the list is broader than it should be — it includes work that is not signed yet. Narrowing it is a filter we are waiting on, not a rebuild.",
      },
    ],
  },
];
