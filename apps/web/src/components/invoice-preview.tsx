import type { ContractorProfile } from '@/lib/buildsuite/contractor-identity';
import { currency, shortDate } from '@/components/ui';

/**
 * What this line will look like once it reaches GoHighLevel.
 *
 * ---------------------------------------------------------------------------
 * WHY A PREVIEW AND NOT JUST A FORM
 *
 * Chris, 10 Sep: when the contractor opens an invoice to send, it should look
 * like a proper invoice — their logo at the top, the client filled in from the
 * proposal, and the work set out as line items. Until now the review screen
 * showed three input boxes and a button, and the first time anybody saw the
 * document was in GoHighLevel, after it had been created and could not be
 * created again.
 *
 * THE RULE THIS COMPONENT KEEPS: it renders only what is known.
 *
 * Every field here is nullable and every one of them is genuinely blank on live
 * data somewhere. So there is no placeholder text standing in for a fact, no
 * "TBC" address, and no $0. A missing amount says "Amount needed", because zero
 * is a figure a contractor could send by accident and blank is the honest
 * representation of "nobody has decided yet".
 * ---------------------------------------------------------------------------
 *
 * Server-rendered and stateless. It reads the same fields the rail sends, so a
 * change to the payload shows up here rather than drifting away from it.
 */

export interface InvoicePreviewProps {
  /** The contractor billing. Null when the session is not linked to one. */
  business: ContractorProfile | null;
  /** The invoice name, exactly as the rail builds it. Carries the project code. */
  reference: string;
  clientName: string;
  /** The homeowner's email, when the project holds one. */
  clientEmail: string | null;
  /** The line item title, as the contractor has it now. */
  title: string;
  /** The payment terms, shown under the title and sent as the invoice notes. */
  terms: string;
  amount: number | null;
  /** Issue and due dates as `YYYY-MM-DD`, computed the way the rail computes them. */
  issueDate: string;
  dueDate: string;
}

/** Up to two initials, for a contractor with no logo on file. */
function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter((word) => word !== '')
    .slice(0, 2)
    .map((word) => word[0] ?? '');
  return letters.join('').toUpperCase();
}

export function InvoicePreview({
  business,
  reference,
  clientName,
  clientEmail,
  title,
  terms,
  amount,
  issueDate,
  dueDate,
}: InvoicePreviewProps) {
  const businessName = business?.businessName ?? null;
  // Joined here rather than rendered as separate lines, so a contractor with
  // only a phone number does not get four rows of white space.
  const contactLine = [business?.phone, business?.email, business?.website, business?.address]
    .filter((part): part is string => part !== null && part !== undefined && part !== '')
    .join(' · ');

  return (
    <div className="mt-3 rounded-lg border border-navy-100 bg-navy-50/40 p-4">
      <p className="text-xs font-medium tracking-wide text-navy-400 uppercase">
        How it will look in GoHighLevel
      </p>

      <div className="mt-3 rounded-lg border border-navy-100 bg-white p-4">
        {/* Letterhead */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            {business !== null && business.logoUrl !== null ? (
              // eslint-disable-next-line @next/next/no-img-element -- an arbitrary
              // contractor logo host cannot be added to the image config, and this
              // is a small preview mark, not a page asset.
              <img
                src={business.logoUrl}
                alt=""
                className="h-10 w-10 rounded-md object-contain"
              />
            ) : businessName !== null ? (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-navy-900 text-xs font-semibold text-white">
                {initialsOf(businessName)}
              </span>
            ) : null}
            <div className="min-w-0">
              {businessName !== null ? (
                <p className="text-sm font-semibold text-navy-900">{businessName}</p>
              ) : (
                <p className="text-sm text-navy-400">
                  No business details on your contractor record yet
                </p>
              )}
              {contactLine !== '' && (
                <p className="mt-0.5 text-xs break-words text-navy-500">{contactLine}</p>
              )}
            </div>
          </div>

          <div className="text-right">
            <p className="text-xs font-medium tracking-wide text-navy-400 uppercase">Invoice</p>
            <p className="text-xs text-navy-600">{reference}</p>
          </div>
        </div>

        {/* Bill to */}
        <div className="mt-4 border-t border-navy-100 pt-3">
          <p className="text-xs font-medium tracking-wide text-navy-400 uppercase">Bill to</p>
          <p className="mt-0.5 text-sm text-navy-900">{clientName}</p>
          {clientEmail !== null && clientEmail !== '' && (
            <p className="text-xs text-navy-500">{clientEmail}</p>
          )}
        </div>

        {/* The line item */}
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-navy-100 text-left text-xs tracking-wide text-navy-400 uppercase">
              <th className="py-2 font-medium">Item</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="py-2 pr-3">
                {title !== '' ? (
                  <span className="font-medium text-navy-900">{title}</span>
                ) : (
                  <span className="text-navy-400">Title needed</span>
                )}
                {terms !== '' && <div className="mt-0.5 text-xs text-navy-500">{terms}</div>}
              </td>
              <td className="tabular py-2 text-right align-top font-medium">
                {amount === null ? (
                  <span className="text-amber-700">Amount needed</span>
                ) : (
                  <span className="text-navy-900">{currency(amount)}</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-navy-100 pt-3 text-xs text-navy-500">
          <span>Issued {shortDate(issueDate)}</span>
          <span>Due {shortDate(dueDate)}</span>
        </div>
      </div>

      <p className="mt-3 text-xs text-navy-400">
        Created as a draft. You send it from GoHighLevel.
      </p>
    </div>
  );
}
