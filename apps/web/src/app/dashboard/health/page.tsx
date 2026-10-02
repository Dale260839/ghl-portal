import { notFound } from 'next/navigation';

import { getSession } from '@/lib/session';
import { isAdminSession } from '@/lib/admin-access';
import { healthReport, type CheckState } from '@/lib/health';
import { Card, CardHeader } from '@/components/ui';

/**
 * Is this deployment working?
 *
 * Operator-only, through the same gate as "Switch account" — and `notFound()`
 * rather than a refusal, because a contractor who is not an operator has no
 * business knowing this page exists.
 *
 * Everything on it is a failure we have actually hit in the last ten days: a
 * revoked key that took sign-in down for an afternoon, four migrations written
 * and not run, email silently off, operator controls on for everybody. Both
 * outages this week were found by a human reading a note or a screenshot.
 */

export const dynamic = 'force-dynamic';

const TONE: Record<CheckState, string> = {
  ok: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  warn: 'bg-amber-soft text-amber-700 ring-amber-600/20',
  fail: 'bg-red-50 text-red-700 ring-red-600/20',
};

const WORD: Record<CheckState, string> = { ok: 'OK', warn: 'Check', fail: 'Broken' };

export default async function HealthPage() {
  if (!isAdminSession(await getSession())) notFound();

  const report = await healthReport();
  const broken = report.checks.filter((c) => c.state === 'fail');
  const warnings = report.checks.filter((c) => c.state === 'warn');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-navy-900">Health</h1>
        <p className="mt-1 text-sm text-navy-400">
          Connections and configuration — never projects, clients or figures.{' '}
          {broken.length === 0 && warnings.length === 0
            ? 'Everything is as it should be.'
            : `${broken.length} broken · ${warnings.length} worth a look.`}
        </p>
      </div>

      <Card>
        <CardHeader
          title="Checks"
          action={
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[report.state]}`}>
              {WORD[report.state]}
            </span>
          }
        />
        <ul className="divide-y divide-navy-100">
          {report.checks.map((check) => (
            <li key={check.name} className="flex items-start justify-between gap-4 px-5 py-3">
              <div className="min-w-0">
                <div className="font-mono text-xs text-navy-900">{check.name}</div>
                <p className="mt-0.5 text-sm leading-relaxed text-navy-600">{check.detail}</p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[check.state]}`}
              >
                {WORD[check.state]}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <p className="text-xs text-navy-400">
        Checked {new Date(report.checkedAt).toLocaleString()}. The same facts are at{' '}
        <code className="font-mono">/api/health</code> as JSON — 503 when something is broken, so a
        monitor can watch it without parsing anything.
      </p>
    </div>
  );
}
