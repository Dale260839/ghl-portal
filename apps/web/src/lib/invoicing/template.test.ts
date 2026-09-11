import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dueDaysFor,
  EMPTY_TEMPLATE,
  mergeLetterhead,
  previewLetterhead,
  safeLogoUrl,
  termsFor,
  validateTemplateInput,
  type InvoiceTemplate,
} from './template.ts';
import { buildGhlInvoicePayload, DEFAULT_DUE_IN_DAYS } from './ghl-rail.ts';

/**
 * Invoice templates (huddle 2026-09-10). A filled-in field wins, a blank one
 * falls through to BuildSuite, and a template is the invoice's LOOK — never
 * its contents.
 */

const PROFILE = {
  businessName: 'Alliance Pro Services',
  logoUrl: 'https://cdn.example.com/aps.png',
  phone: '555-0100',
  website: 'allianceproservices.com',
  address: '1 Main St, Bellevue, WA',
  email: 'office@aps.example',
};

const template = (over: Partial<InvoiceTemplate> = {}): InvoiceTemplate => ({ ...EMPTY_TEMPLATE, ...over });

// ── Validation ───────────────────────────────────────────────────────────────

test('every field is optional, and blanks become null rather than empty strings', () => {
  const r = validateTemplateInput({ businessName: '  ', logoUrl: '', dueInDays: '' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.template, EMPTY_TEMPLATE);
});

test('the logo must be a real https link', () => {
  // It is fetched by GoHighLevel and rendered in the Hub's own preview.
  for (const bad of [
    'http://cdn.example.com/logo.png',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'logo.png',
    'ftp://example.com/logo.png',
    'https://',
    'see https://example.com/logo.png',
  ]) {
    const r = validateTemplateInput({ logoUrl: bad });
    assert.equal(r.ok, false, `accepted ${bad}`);
    assert.match(!r.ok ? r.errors.logoUrl ?? '' : '', /https/);
  }
  const ok = validateTemplateInput({ logoUrl: 'https://cdn.example.com/logo.png' });
  assert.equal(ok.ok && ok.template.logoUrl, 'https://cdn.example.com/logo.png');
});

test('each field is limited to what the database allows', () => {
  const r = validateTemplateInput({ businessName: 'x'.repeat(121), standingTerms: 'y'.repeat(2001) });
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.businessName && r.errors.standingTerms);
});

test('days until due is a whole number from 0 to 90', () => {
  for (const bad of ['-1', '91', '2.5', 'soon', '1e3']) {
    assert.equal(validateTemplateInput({ dueInDays: bad }).ok, false, `accepted ${bad}`);
  }
  const r = validateTemplateInput({ dueInDays: '14' });
  assert.equal(r.ok && r.template.dueInDays, 14);
  assert.equal(validateTemplateInput({ dueInDays: '0' }).ok, true, 'due on receipt is allowed');
});

test('errors name the field that is wrong, not just that something is', () => {
  const r = validateTemplateInput({ logoUrl: 'nope', dueInDays: '400', phone: '555' });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(!r.ok ? r.errors : {}).sort(), ['dueInDays', 'logoUrl']);
});

// ── The merge ────────────────────────────────────────────────────────────────

test('an empty template changes nothing — invoices look exactly as before', () => {
  assert.deepEqual(mergeLetterhead(PROFILE, EMPTY_TEMPLATE), mergeLetterhead(PROFILE, null));
  assert.equal(mergeLetterhead(PROFILE, null)?.name, 'Alliance Pro Services');
});

test('a filled-in field overrides BuildSuite, a blank one falls through', () => {
  const merged = mergeLetterhead(
    PROFILE,
    template({ logoUrl: 'https://new.example.com/logo.png', phone: '555-0199' }),
  );
  assert.equal(merged?.logoUrl, 'https://new.example.com/logo.png');
  assert.equal(merged?.phone, '555-0199');
  assert.equal(merged?.name, 'Alliance Pro Services', 'unset fields keep BuildSuite values');
  assert.equal(merged?.address, '1 Main St, Bellevue, WA');
});

test('a template can supply a name BuildSuite never had', () => {
  const merged = mergeLetterhead(
    { ...PROFILE, businessName: null },
    template({ businessName: 'Michael Drywall LLC' }),
  );
  assert.equal(merged?.name, 'Michael Drywall LLC');
});

test('no name anywhere means no business block at all', () => {
  // GoHighLevel then uses the location's own settings, rather than printing a
  // half-empty letterhead or somebody else's name.
  assert.equal(mergeLetterhead({ ...PROFILE, businessName: null }, EMPTY_TEMPLATE), undefined);
  assert.equal(mergeLetterhead(null, null), undefined);
});

test('an unsafe logo from BuildSuite is dropped, not sent', () => {
  // The form would refuse it; the invoice must not carry what the form refuses.
  const merged = mergeLetterhead({ ...PROFILE, logoUrl: 'javascript:alert(1)' }, null);
  assert.equal(merged?.logoUrl, null);
});

test('the preview is built from the same merge the invoice is', () => {
  // "What a contractor reads here is what GoHighLevel receives."
  const t = template({ logoUrl: 'https://new.example.com/logo.png', businessName: 'APS Renamed' });
  const merged = mergeLetterhead(PROFILE, t)!;
  const preview = previewLetterhead(PROFILE, t)!;
  assert.equal(preview.businessName, merged.name);
  assert.equal(preview.logoUrl, merged.logoUrl);
  assert.equal(preview.phone, merged.phone);
  assert.equal(preview.email, PROFILE.email, 'email is not a template field and passes through');
});

// ── Terms and due dates ──────────────────────────────────────────────────────

test('standing terms come AFTER the stage terms, never instead of them', () => {
  const t = template({ standingTerms: 'Checks payable to APS LLC.' });
  assert.equal(termsFor('30% upon signing.', t), '30% upon signing.\n\nChecks payable to APS LLC.');
  assert.equal(termsFor('30% upon signing.', null), '30% upon signing.');
  assert.equal(termsFor('', t), 'Checks payable to APS LLC.');
});

test('days until due fall back to the Hub default', () => {
  assert.equal(dueDaysFor(null), DEFAULT_DUE_IN_DAYS);
  assert.equal(dueDaysFor(template({ dueInDays: 14 })), 14);
  assert.equal(dueDaysFor(template({ dueInDays: 0 })), 0, 'zero is a real answer, not a missing one');
});

test('the invoice GoHighLevel receives carries the template', () => {
  const t = template({ standingTerms: 'Checks payable to APS LLC.', logoUrl: 'https://new.example.com/l.png' });
  const payload = buildGhlInvoicePayload(
    {
      reference: 'BSA-APS-001 · Invoice 1',
      milestone: 'Contract Signing',
      terms: '30% upon signing.',
      amount: 9223.5,
    } as never,
    { ghlContactId: 'c1', name: 'Zander', email: 'z@example.com' } as never,
    {
      locationId: 'loc',
      business: mergeLetterhead(PROFILE, t),
      issue: new Date('2026-09-12T12:00:00Z'),
      dueInDays: dueDaysFor(template({ dueInDays: 14 })),
      standingTerms: t.standingTerms,
    },
  );

  assert.equal(payload.businessDetails?.logoUrl, 'https://new.example.com/l.png');
  assert.equal(payload.termsNotes, '30% upon signing.\n\nChecks payable to APS LLC.');
  // The line item keeps the stage's own terms only.
  assert.equal(payload.items[0]!.description, '30% upon signing.');
  assert.equal(payload.dueDate, '2026-09-26');
  // A template is the look, never the contents.
  assert.equal(payload.items[0]!.amount, 9223.5);
  assert.equal(payload.items[0]!.name, 'Contract Signing');
});

test('safeLogoUrl parses the URL rather than matching a substring', () => {
  assert.equal(safeLogoUrl('https://evil.example/logo.png'), 'https://evil.example/logo.png');
  assert.equal(safeLogoUrl('javascript://https://cdn.example.com/x'), null);
  assert.equal(safeLogoUrl(null), null);
});
