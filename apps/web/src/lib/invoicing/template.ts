import type { InvoiceBusinessDetails } from './ghl-rail.ts';
import { combineTerms, DEFAULT_DUE_IN_DAYS } from './ghl-rail.ts';

/**
 * A contractor's invoice template, and how it combines with their BuildSuite
 * profile.
 *
 * Chris, huddle 2026-09-10: "reusable invoice templates with company logos that
 * contractors can customize per account."
 *
 * ---------------------------------------------------------------------------
 * THE RULE: A FILLED-IN FIELD WINS, A BLANK ONE FALLS THROUGH
 *
 * The letterhead used to come only from BuildSuite's `contractors` row, which
 * the Hub cannot write — so a contractor could not change their own invoice
 * logo from here at all. Each template field overrides its BuildSuite
 * counterpart when filled in, and falls through to it when blank. An empty
 * template therefore changes nothing about invoices that already work.
 *
 * Two fields have no BuildSuite counterpart: standing terms, printed on every
 * invoice after the stage's own terms; and the days until an invoice is due.
 *
 * A template is the LOOK of an invoice, never its contents. The stages and
 * amounts come from each job's signed contract, and nothing here can touch them.
 * ---------------------------------------------------------------------------
 *
 * Pure: no database, no request. The repository stores it and the action
 * applies it; the rules live here so both can be tested without either.
 */

export interface InvoiceTemplate {
  businessName: string | null;
  logoUrl: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  standingTerms: string | null;
  dueInDays: number | null;
}

export const EMPTY_TEMPLATE: InvoiceTemplate = {
  businessName: null,
  logoUrl: null,
  phone: null,
  website: null,
  address: null,
  standingTerms: null,
  dueInDays: null,
};

/** The limits the migration enforces, repeated so a form can refuse first. */
export const TEMPLATE_LIMITS = {
  businessName: 120,
  logoUrl: 1000,
  phone: 40,
  website: 300,
  address: 300,
  standingTerms: 2000,
  maxDueInDays: 90,
} as const;

export type TemplateValidation =
  | { ok: true; template: InvoiceTemplate }
  | { ok: false; errors: Partial<Record<keyof InvoiceTemplate, string>> };

function blankToNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

/**
 * A logo URL that is safe to send to GoHighLevel and to render in an `<img>`.
 *
 * https only. The logo is fetched by GoHighLevel and shown in the Hub's own
 * preview; an http image on an https page is blocked or warned about by every
 * browser, and a `javascript:` or `data:` value has no business on an invoice.
 * Parsed with `URL`, not matched with a regex, so `https://` has to be the
 * actual scheme rather than a substring somewhere in the value.
 */
export function safeLogoUrl(value: string | null): string | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname !== '' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Validate what a contractor typed. Every field optional; each one checked.
 *
 * Errors are returned per field rather than thrown, so the form can say which
 * box is wrong instead of refusing the whole thing with a generic message.
 */
export function validateTemplateInput(input: Record<string, unknown>): TemplateValidation {
  const errors: Partial<Record<keyof InvoiceTemplate, string>> = {};

  const text = (key: keyof typeof TEMPLATE_LIMITS & keyof InvoiceTemplate, label: string) => {
    const value = blankToNull(input[key]);
    const limit = TEMPLATE_LIMITS[key];
    if (value !== null && value.length > limit) {
      errors[key] = `${label} can be at most ${limit} characters.`;
    }
    return value;
  };

  const businessName = text('businessName', 'Business name');
  const phone = text('phone', 'Phone');
  const website = text('website', 'Website');
  const address = text('address', 'Address');
  const standingTerms = text('standingTerms', 'Payment terms');

  const rawLogo = text('logoUrl', 'Logo link');
  let logoUrl: string | null = null;
  if (rawLogo !== null && errors.logoUrl === undefined) {
    logoUrl = safeLogoUrl(rawLogo);
    if (logoUrl === null) errors.logoUrl = 'The logo must be a full https:// link to an image.';
  }

  const rawDays = blankToNull(input.dueInDays);
  let dueInDays: number | null = null;
  if (rawDays !== null) {
    const n = Number(rawDays);
    if (!Number.isInteger(n) || n < 0 || n > TEMPLATE_LIMITS.maxDueInDays) {
      errors.dueInDays = `Days until due must be a whole number from 0 to ${TEMPLATE_LIMITS.maxDueInDays}.`;
    } else {
      dueInDays = n;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    template: { businessName, logoUrl, phone, website, address, standingTerms, dueInDays },
  };
}

/** What BuildSuite knows about the contractor. `ContractorProfile` satisfies it. */
export interface ProfileLetterhead {
  businessName: string | null;
  logoUrl: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
}

/**
 * The letterhead an invoice actually carries.
 *
 * Template field if filled in, else BuildSuite's. No business block at all when
 * neither supplies a name — the rail's existing rule, kept: GoHighLevel then
 * falls back to the location's own settings rather than printing a half-empty
 * letterhead or somebody else's name.
 *
 * The BuildSuite logo is passed through the same https check as the template's,
 * so the preview and the invoice can never render a value the form would have
 * refused.
 */
export function mergeLetterhead(
  profile: ProfileLetterhead | null,
  template: InvoiceTemplate | null,
): InvoiceBusinessDetails | undefined {
  const pick = (own: string | null | undefined, fallback: string | null | undefined) =>
    blankToNull(own) ?? blankToNull(fallback);

  const name = pick(template?.businessName, profile?.businessName);
  if (name === null) return undefined;

  return {
    name,
    logoUrl: safeLogoUrl(pick(template?.logoUrl, profile?.logoUrl)),
    phone: pick(template?.phone, profile?.phone),
    website: pick(template?.website, profile?.website),
    address: pick(template?.address, profile?.address),
  };
}

/**
 * The merged letterhead in the shape `InvoicePreview` renders.
 *
 * The review screen promises "what a contractor reads here is what GoHighLevel
 * receives". Once a template can override the letterhead, previewing the raw
 * BuildSuite profile would break that promise silently — the screen would show
 * one logo and the invoice would carry another. So the preview is built from
 * the same `mergeLetterhead` the invoice is.
 *
 * `email` is not a template field; it passes through from the profile.
 */
export function previewLetterhead(
  profile: (ProfileLetterhead & { email: string | null }) | null,
  template: InvoiceTemplate | null,
): (ProfileLetterhead & { email: string | null }) | null {
  const merged = mergeLetterhead(profile, template);
  if (merged === undefined) return profile;
  return {
    businessName: merged.name,
    logoUrl: merged.logoUrl ?? null,
    phone: merged.phone ?? null,
    website: merged.website ?? null,
    address: merged.address ?? null,
    email: profile?.email ?? null,
  };
}

/** Days until due: the template's, or the Hub's default. */
export function dueDaysFor(template: InvoiceTemplate | null): number {
  return template?.dueInDays ?? DEFAULT_DUE_IN_DAYS;
}

/**
 * The terms printed on an invoice: the stage's own terms from the contract
 * first, then the contractor's standing terms. Either may be absent; neither is
 * ever replaced by the other, because the stage's terms are what the homeowner
 * signed and the standing terms are the contractor's house rules.
 */
export function termsFor(stageTerms: string, template: InvoiceTemplate | null): string {
  // The rail owns this rule — one copy of it, so the preview and the invoice
  // GoHighLevel receives can never compose the terms differently.
  return combineTerms(stageTerms, template?.standingTerms);
}
