-- 0008 · Where a draft went when it reached a rail
--
-- 0007 stored what a contractor decided. It had nowhere to record that the
-- invoice now also exists somewhere else — so creating one in GoHighLevel and
-- then re-opening the screen would offer to create it again, and the second one
-- would be just as real as the first.
--
-- `sent_via` already exists for the rail's name. These three say WHICH invoice,
-- and are the reason a second create can be refused.

alter table public.hub_invoice_drafts
  -- The rail's own id for this invoice. GoHighLevel's `_id`.
  add column if not exists external_id     text,
  -- Where a contractor opens it to review and send. Rail-supplied; we never
  -- construct one, because a guessed URL that 404s looks like a lost invoice.
  add column if not exists external_url    text,
  -- When it reached the rail. Deliberately NOT `sent_at`: creating a draft in
  -- GoHighLevel is not sending it to anybody. A person still clicks send there,
  -- which is Chris's rule, and until they do `sent_at` stays null.
  add column if not exists rail_created_at timestamptz;

-- One invoice per draft on any given rail. Creating a second for the same line
-- is the failure this table exists to prevent: two live invoices for one
-- instalment, both of which a homeowner could be asked to pay.
create unique index if not exists hub_invoice_drafts_external_id_idx
  on public.hub_invoice_drafts (external_id)
  where external_id is not null;

comment on column public.hub_invoice_drafts.external_id is
  'The rail''s id for this invoice. Non-null means it exists on the rail and must not be created again.';
