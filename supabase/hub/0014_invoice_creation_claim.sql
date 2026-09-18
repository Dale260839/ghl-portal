-- Durable single-winner claim before external invoice creation.
-- Never automatically expire: an interrupted request may already have reached GHL.
alter table public.hub_invoice_drafts
  add column if not exists creation_attempt_id uuid,
  add column if not exists creation_started_at timestamptz;

notify pgrst, 'reload schema';
