'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export function OpenWorkspaceLanding() {
  const started = useRef(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = window.location.hash.slice(1);
    window.history.replaceState(null, '', window.location.pathname);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { setError('Open Project Hub from GoHighLevel to continue.'); return; }
    void (async () => {
      try {
        const response = await fetch('/api/auth/open-workspace', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'redeem', token }) });
        const result = await response.json();
        if (!response.ok || result.redirectTo !== '/dashboard') throw new Error(result.error || 'Could not open Project Hub.');
        window.location.replace('/dashboard');
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not connect. Open Project Hub from GoHighLevel again.'); }
    })();
  }, []);
  return <main className="flex min-h-dvh items-center justify-center bg-navy-50 px-6">
    <div className="w-full max-w-sm text-center">
      <h1 className="text-xl font-semibold text-navy-900">Project Hub</h1>
      <p role={error ? 'alert' : 'status'} className="mt-3 text-sm text-navy-600">{error || 'Opening your workspace...'}</p>
      {error && <Link href="/" className="mt-5 inline-block rounded-md border border-navy-200 bg-white px-4 py-2 text-sm text-navy-700">Go to sign-in</Link>}
    </div>
  </main>;
}
