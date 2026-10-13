'use client';
import { useState } from 'react';
import { ExternalLink } from 'lucide-react';

export function OpenWorkspace() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function open() {
    setPending(true);
    setError('');
    const popup = window.open('about:blank', '_blank');
    if (!popup) { setError('Allow a new tab, then try again.'); setPending(false); return; }
    popup.opener = null;
    try {
      const response = await fetch('/api/auth/open-workspace', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'issue' }) });
      const result = await response.json();
      if (!response.ok || typeof result.token !== 'string') throw new Error(result.error || 'Could not open Project Hub.');
      popup.location.replace(`${window.location.origin}/auth/open-workspace#${result.token}`);
    } catch (cause) {
      popup.close();
      setError(cause instanceof Error ? cause.message : 'Could not open Project Hub. Try again.');
    } finally { setPending(false); }
  }
  return <div className="relative shrink-0">
    <button type="button" onClick={open} disabled={pending} aria-label="Open Project Hub in a new tab"
      title="Open Project Hub in a new tab"
      className="flex h-10 w-10 items-center justify-center rounded-md border border-navy-100 bg-white text-navy-700 hover:bg-navy-50 disabled:opacity-50">
      <ExternalLink size={16} aria-hidden="true" />
    </button>
    {error && <p role="alert" className="absolute top-12 right-0 z-50 w-64 max-w-[80vw] rounded-md border border-red-200 bg-white p-3 text-xs text-red-700 shadow">{error}</p>}
  </div>;
}
