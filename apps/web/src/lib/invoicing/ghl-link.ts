export function ghlInvoiceEditorUrl(locationId: string, invoiceId: string): string {
  return `https://app.gohighlevel.com/v2/location/${encodeURIComponent(locationId)}/payments/invoices/${encodeURIComponent(invoiceId)}`;
}

/** Upgrade previously stored links without rewriting invoice records. */
export function currentInvoiceUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://app.gohighlevel.com') return value;
    const match = /^\/location\/([^/]+)\/invoices\/([^/]+)\/?$/.exec(url.pathname);
    return match ? ghlInvoiceEditorUrl(decodeURIComponent(match[1]!), decodeURIComponent(match[2]!)) : value;
  } catch {
    return value;
  }
}
