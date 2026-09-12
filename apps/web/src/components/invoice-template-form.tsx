'use client';

import { useActionState } from 'react';

import { SubmitButton } from '@/components/submit-button';
import { saveInvoiceTemplate } from '@/lib/actions';

/**
 * The invoice template form (huddle 2026-09-10).
 *
 * Every field is optional, and each one says what it falls back to: the value
 * on the contractor's BuildSuite record, shown as the placeholder. A blank box
 * is not "nothing" — it is "use what BuildSuite has", and the placeholder is how
 * a contractor can see that without reading documentation.
 *
 * Types only are imported from the template module: the limits arrive as a prop
 * so no server module is pulled into the browser bundle.
 */

interface TemplateValues {
  businessName: string | null;
  logoUrl: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  standingTerms: string | null;
  dueInDays: number | null;
}

interface Fallback {
  businessName: string | null;
  logoUrl: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
}

const FIELD =
  'mt-1 w-full rounded-lg border border-navy-200 px-3 py-2 text-sm text-navy-900 placeholder:text-navy-300 focus-visible:border-navy-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-navy-600';

export function InvoiceTemplateForm({
  initial,
  fallback,
  canSave,
  problem,
  limits,
  defaultDueInDays,
}: {
  initial: TemplateValues | null;
  fallback: Fallback | null;
  canSave: boolean;
  problem: string | null;
  limits: {
    businessName: number;
    logoUrl: number;
    phone: number;
    website: number;
    address: number;
    standingTerms: number;
    maxDueInDays: number;
  };
  defaultDueInDays: number;
}) {
  const [state, action] = useActionState(saveInvoiceTemplate, undefined);
  const errors = state?.errors ?? {};

  const fromBuildSuite = (value: string | null | undefined, none: string) =>
    value !== null && value !== undefined && value.trim() !== ''
      ? `From BuildSuite: ${value}`
      : none;

  // The logo is a storage URL made of three UUIDs — printed as a hint it is
  // exactly the "random string" nobody should be shown (John, 2026-09-12). The
  // preview beside this form already shows the logo itself.
  const logoHint =
    (fallback?.logoUrl ?? '').trim() !== '' ? 'From BuildSuite: your current logo' : 'https://…/logo.png';

  const text = (
    name: keyof Fallback,
    label: string,
    max: number,
    none: string,
    type: 'text' | 'url' | 'tel' = 'text',
  ) => (
    <label className="block text-sm font-medium text-navy-800">
      {label}
      <input
        name={name}
        type={type}
        maxLength={max}
        defaultValue={initial?.[name] ?? ''}
        placeholder={name === 'logoUrl' ? logoHint : fromBuildSuite(fallback?.[name], none)}
        disabled={!canSave}
        aria-invalid={errors[name] !== undefined}
        className={FIELD}
      />
      {errors[name] !== undefined && (
        <span className="mt-1 block text-xs font-normal text-red-700">{errors[name]}</span>
      )}
    </label>
  );

  return (
    <form action={action} className="space-y-4">
      {problem !== null && (
        <p className="rounded-lg border border-amber-600/25 bg-amber-50/70 px-4 py-3 text-sm text-navy-900">
          {problem}
        </p>
      )}
      {state?.message !== undefined && (
        <p className="rounded-lg border border-amber-600/25 bg-amber-50/70 px-4 py-3 text-sm text-navy-900" role="alert">
          {state.message}
        </p>
      )}
      {state?.saved === true && (
        <p className="rounded-lg border border-emerald-600/25 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-800" role="status">
          Saved. Every invoice you create from now on uses this template.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {text('businessName', 'Business name', limits.businessName, 'Your business name')}
        {text('logoUrl', 'Logo link (https://)', limits.logoUrl, 'https://…/logo.png', 'url')}
        {text('phone', 'Phone', limits.phone, 'Phone on your invoices', 'tel')}
        {text('website', 'Website', limits.website, 'www.example.com')}
      </div>
      {text('address', 'Address', limits.address, 'Street, city, state, ZIP')}

      <label className="block text-sm font-medium text-navy-800">
        Payment terms on every invoice
        <textarea
          name="standingTerms"
          rows={4}
          maxLength={limits.standingTerms}
          defaultValue={initial?.standingTerms ?? ''}
          placeholder="e.g. Checks payable to Your Company LLC. A 1.5% monthly fee applies after the due date."
          disabled={!canSave}
          aria-invalid={errors.standingTerms !== undefined}
          className={FIELD}
        />
        <span className="mt-1 block text-xs font-normal text-navy-400">
          Printed after each stage&apos;s own terms from the signed contract — never instead of
          them.
        </span>
        {errors.standingTerms !== undefined && (
          <span className="mt-1 block text-xs font-normal text-red-700">{errors.standingTerms}</span>
        )}
      </label>

      <label className="block max-w-xs text-sm font-medium text-navy-800">
        Days until an invoice is due
        <input
          name="dueInDays"
          type="number"
          min={0}
          max={limits.maxDueInDays}
          step={1}
          defaultValue={initial?.dueInDays ?? ''}
          placeholder={`${defaultDueInDays} (the default)`}
          disabled={!canSave}
          aria-invalid={errors.dueInDays !== undefined}
          className={FIELD}
        />
        {errors.dueInDays !== undefined && (
          <span className="mt-1 block text-xs font-normal text-red-700">{errors.dueInDays}</span>
        )}
      </label>

      <div className="flex items-center gap-3">
        <SubmitButton disabled={!canSave}>Save template</SubmitButton>
        <span className="text-xs text-navy-400">Leave a box empty to use what BuildSuite has.</span>
      </div>
    </form>
  );
}
