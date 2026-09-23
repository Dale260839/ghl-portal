# Printable invoice and payment history

Request: meeting recording September 22, 14:43-18:09. Complete invoice totals,
tax, notes, and payments on other installments, without pretending an earlier
installment payment is also a credit on the current invoice.

## Implemented

- Contractor-only `View / print invoice` link on each linked Hub invoice.
- A clean Letter-size invoice for printing or saving as PDF: logo and compact
  business address, bill-to, number, project, dates, descriptions and line totals,
  subtotal, tax, invoice total, paid on this invoice, amount due, prior issued
  installment receipts, and notes and terms.
- GHL notes are sanitized before they enter the printable page. Drafts are
  visibly marked `DRAFT - NOT SENT`.
- Fresh GET of the exact GHL invoice IDs linked to the project. Location,
  contact and invoice identity are checked before displaying financial data.
- Subtotal, discount, tax, invoice total, paid on this invoice and current due.
  Missing subtotal/tax remains unknown, not zero. Exact cents are preserved.
- Other issued project invoices list actual GHL receipts and outstanding amounts.
  Drafts and voids are excluded. Processing or unreadable records stop the summary.
- Newly created drafts include an as-of payment-history snapshot in GHL notes.
  The stage terms and contractor standing terms are preserved.
- Earlier receipts are never subtracted from a later installment. No payment,
  invoice send, automatic tax choice, or existing-invoice rewrite is performed.
- No database migration or new credentials required.

## Boundaries

This does not replace GHL's native invoice layout or what GHL's Send command
delivers. To send this full layout, the contractor must save the Hub print view
as a PDF and attach it through an approved sending workflow. The Hub toolbar
states the difference. GHL determines where its native tax and payment rows appear.
Tax is selected and reviewed in the GHL draft editor. This change does not
choose tax rates or infer exemption.

An outside payment appears only after it is recorded in GHL against an invoice
explicitly linked to this project. We cannot join unrelated invoices by contact
or title: one homeowner may have several projects. Manual/unlinked records are
excluded and disclosed. The notes snapshot does not auto-refresh before send;
the summary reads fresh data when opened.

## Authorized production verification

Deploy and update only existing APS test draft INV-000003, external ID
6aadca348ccfb1b3ee1178f7. No send, charge, payment recording or tax-rate change.
Keep its $1,212.50 amount and all existing terms. Verify current records first.

## Checks

Unit coverage: missing fields, identities, currency, draft/void/processing status,
partial receipts, duplicate references, HTML escaping, data-read failures,
pagination boundary, unchanged installment amount, read-only GHL requests.
Existing 20-attempt concurrency test still permits exactly one draft creation.

## Production verification, September 23

- Deployment 98953e4 succeeded; the summary opened through the authenticated
  APS contractor session and read INV-000003 successfully.
- Actual API subtotal/total/due $1,212.50; tax/discount/paid $0.00.
- GHL list: three drafts, $4,944.83; zero received. No earlier issued invoice
  exists for BSA-APS-002. INV-000002 remains a $1,455.00 draft, not a receipt.
- Appended a clearly dated breakdown and project-history example to INV-000003
  using the GHL editor. Preserved Shipping Details and Terms. Save verified by
  a fresh API-backed summary read. No send or payment action.
- API due-date field previously read September 24 while the GHL editor displayed
  September 23. Timestamp dates in the new print view use the sub-account's
  verified timezone; date-only values keep their calendar date. The live APS
  print view and GHL editor both displayed September 23 after deployment.
- The approved APS test draft's duplicate breakdown notes were replaced with
  concise demo terms. Its prior text is backed up outside the repository in
  `C:/Users/Lenovo/Desktop/chris/APS-INV-000003-NOTES-BEFORE-2026-09-23.txt`.
- Automatic refresh of already-created invoice notes and linking invoices
  created wholly outside the Hub are not implemented.
