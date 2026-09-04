-- ═══════════════════════════════════════════════════════════════════════════
-- 0007 · Invoice drafts
--
-- The Hub's half of the invoice flow Chris walked through. Run against the HUB
-- database (nexpqqxarimqmntnvzff), never BuildSuite.
--
-- WHY THE HUB OWNS THIS
-- D4 rule 5 makes GoHighLevel the operational system of record after handoff,
-- but that is a boundary rule, not a schema rule: where the Hub stores what it
-- reads is ours. A draft invoice is not an operational record yet — it is a
-- contractor's work-in-progress on a document nobody has sent. It becomes GHL's
-- (or Stripe's) the moment it is sent, and this table records that moment
-- rather than trying to own what happens after it.
--
-- WHY IT HAS TO EXIST AT ALL, given the send is still gated on the rail
-- The payment schedule in BuildSuite cannot produce an invoice on its own.
-- Measured across all 46 proposals on 2026-09-03: 125 schedule lines, every one
-- carrying a percent, but only 35 carrying a dollar amount — and for all four
-- SIGNED proposals there is no amount and no title, because `proposals.total`
-- is null and `proposals.price` is a band string like "$2,000 - $5,000".
--
-- So the contractor supplies the number. That work must survive whichever rail
-- is eventually chosen, which is exactly why this is stored before the rail is
-- settled rather than after.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.hub_invoice_drafts (
  id                uuid primary key default gen_random_uuid(),

  -- Tenancy. `contractor_id` is `contractors.id`, NOT an auth profile id —
  -- the two were conflated once and it hid a contractor's own records.
  contractor_id     uuid not null,
  project_id        uuid not null,

  -- Which proposal's schedule this came from, and which line of it. `line_order`
  -- is 1-based and matches `ScheduleLine.order`, so the deposit is line 1 and
  -- every later milestone has its own row. Deliberately not "is_deposit": the
  -- handoff is explicit that this must not hardcode first-line-only.
  proposal_id       uuid not null,
  line_order        integer not null check (line_order >= 1),

  -- What the proposal said, kept verbatim so a contractor can see what was
  -- parsed and what they changed. `source_raw` is the schedule line as written.
  source_percent    numeric(6,3),
  source_amount     numeric(14,2),
  source_raw        text not null default '',

  -- What the contractor decided. Null means they have not supplied it yet,
  -- which is NOT the same as zero — a zero invoice is a figure somebody could
  -- send to a homeowner by accident.
  title             text,
  amount            numeric(14,2) check (amount is null or amount >= 0),
  description       text,
  notes             text,

  -- Lifecycle. `sent_at` is set by whichever rail eventually sends it; nothing
  -- in the Hub sets it today, and the column exists so that the review step and
  -- the send step do not have to be built in the same change.
  status            text not null default 'draft'
                      check (status in ('draft', 'ready', 'sent', 'void')),
  sent_at           timestamptz,
  sent_by           text,
  -- Free text on purpose. Which rail sent it is not the Hub's decision to
  -- constrain before the decision is made.
  sent_via          text,

  created_at        timestamptz not null default now(),
  created_by        text,
  updated_at        timestamptz not null default now(),
  updated_by        text
);

-- One draft per schedule line per proposal. Re-opening the review screen must
-- update the contractor's existing draft, not silently create a second one that
-- could both be sent.
create unique index if not exists hub_invoice_drafts_line_unique
  on public.hub_invoice_drafts (proposal_id, line_order);

-- The read the review screen actually makes.
create index if not exists hub_invoice_drafts_project_idx
  on public.hub_invoice_drafts (contractor_id, project_id);

-- RLS stays OFF here, consistent with 0002 and the owner's decision to defer
-- it. Noted rather than silently omitted: this table will hold contract money
-- for real jobs, so it belongs on the list of things to cover the day RLS goes
-- on, and it is the first Hub table for which that is true.
alter table public.hub_invoice_drafts disable row level security;
