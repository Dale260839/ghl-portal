-- 0013 · Invoice templates — one per contractor account.
--
-- Chris, huddle 2026-09-10: "reusable invoice templates with company logos that
-- contractors can customize per account."
--
-- WHY THE HUB HOLDS THIS
--
-- The letterhead on invoices is read from BuildSuite's `contractors` row
-- (business_name, business_logo_url, phone, website, address). BuildSuite is
-- read-only to the Hub, so until now a contractor had NO way to change the logo
-- or contact details on their own invoices from the Hub — only by getting their
-- BuildSuite record edited.
--
-- A template here OVERRIDES those fields where it is filled in, and adds the two
-- things BuildSuite has no column for at all: standing payment terms printed on
-- every invoice, and how many days an invoice gives before it falls due. Any
-- field left blank falls through to BuildSuite, so an empty template changes
-- nothing about invoices already working today.
--
-- WHAT IT DOES NOT HOLD
--
-- The stages and amounts. Those come from each job's signed contract, so every
-- invoice bills exactly what that homeowner agreed to. A template is the look
-- of the invoice, never its contents.
--
-- ONE PER ACCOUNT
--
-- Unique on contractor_id: a contractor sets it once and every invoice uses it.
-- Several named templates per account would need a picker at invoice time and a
-- decision about which is the default; that is a later step if it is wanted,
-- and this table can grow a `name` column without changing what it holds now.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- RUN ORDER: after HUB_SUPABASE_KEY is the secret key (see 0010). RLS is enabled
-- below with no policies, like every other Hub table since 0010, so the
-- publishable key cannot reach this table at all.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.hub_invoice_templates (
  id              uuid primary key default gen_random_uuid(),
  -- The account this belongs to. Tenancy key; every read and write filters on it.
  contractor_id   uuid not null,

  -- Overrides for the letterhead. Null means "use what BuildSuite has".
  business_name   text check (business_name is null or length(business_name) <= 120),
  -- https only: GoHighLevel fetches it, and it is rendered in the Hub's preview.
  logo_url        text check (logo_url is null or (logo_url ~* '^https://' and length(logo_url) <= 1000)),
  phone           text check (phone is null or length(phone) <= 40),
  website         text check (website is null or length(website) <= 300),
  address         text check (address is null or length(address) <= 300),

  -- Printed on every invoice, after the stage's own terms from the contract.
  standing_terms  text check (standing_terms is null or length(standing_terms) <= 2000),
  -- Days from issue until due. Null means the Hub's default (5).
  due_in_days     integer check (due_in_days is null or (due_in_days >= 0 and due_in_days <= 90)),

  created_at      timestamptz not null default now(),
  created_by      text,
  updated_at      timestamptz not null default now(),
  updated_by      text
);

create unique index if not exists hub_invoice_templates_contractor
  on public.hub_invoice_templates (contractor_id);

alter table public.hub_invoice_templates enable row level security;
