import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentInvoiceUrl, ghlInvoiceEditorUrl } from './ghl-link.ts';

test('invoice editor uses the working v2 payments route', () => {
  assert.equal(ghlInvoiceEditorUrl('APS', 'invoice-1'), 'https://app.gohighlevel.com/v2/location/APS/payments/invoices/invoice-1');
});
test('stored legacy draft links are upgraded without another invoice creation', () => {
  const expected = ghlInvoiceEditorUrl('APS', 'invoice-1');
  assert.equal(currentInvoiceUrl('https://app.gohighlevel.com/location/APS/invoices/invoice-1'), expected);
  assert.equal(currentInvoiceUrl(expected), expected);
});
test('unrelated and invalid links are not interpreted as legacy GHL links', () => {
  for (const value of ['invalid', 'https://example.com/location/APS/invoices/i', 'https://app.gohighlevel.com/other']) {
    assert.equal(currentInvoiceUrl(value), value);
  }
});
