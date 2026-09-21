import 'server-only';

import { getGhlEmail } from '../ghl/email.ts';
import { resolveContractorName, resolveContractorProfile } from '../buildsuite/contractor-identity.ts';
import { appUrl } from '../app-url.ts';
import type { TenantScope } from '../tenancy.ts';
import { buildFieldSubmissionEmail, type FieldSubmission } from './pm-email.ts';

/**
 * Tell the PM their crew sent something.
 *
 * Best effort, always: the update is already saved by the time this runs, and
 * a mail server having a bad minute must never lose a crew member's work. The
 * reason comes back so the crew's screen can say plainly whether anyone was
 * told — "sent to your PM" and "saved, but nobody was emailed" are different
 * facts and a person on a roof deserves the true one.
 *
 * The address is the contractor's own record in BuildSuite, the same one the
 * invoices use. Never a crew member's, never the homeowner's.
 */
export async function notifyPmOfFieldSubmission(
  scope: TenantScope,
  input: Omit<FieldSubmission, 'companyName' | 'reviewUrl'> & { projectId: string },
): Promise<{ sent: boolean; reason: string }> {
  try {
    const mail = await getGhlEmail(scope.locationId);
    if (!mail.available) return { sent: false, reason: `email unconfigured: ${mail.missing.join(', ')}` };

    const profile = await resolveContractorProfile(scope).catch(() => null);
    const to = (profile?.email ?? '').trim();
    if (to === '') return { sent: false, reason: 'no contractor email on file' };

    const companyName = (await resolveContractorName(scope).catch(() => null)) ?? '';
    const base = await appUrl();
    const message = buildFieldSubmissionEmail({
      ...input,
      companyName,
      reviewUrl: `${base}/dashboard/updates`,
    });

    const result = await mail.email.send({
      email: to,
      name: companyName || 'Project Hub',
      subject: message.subject,
      html: message.html,
      source: 'Project Hub field update',
    });
    if (!result.sent) {
      console.warn(`[notify] PM email not sent (${result.reason}): ${result.detail}`);
      return { sent: false, reason: result.reason };
    }
    return { sent: true, reason: 'sent' };
  } catch (error) {
    console.error('[notify] PM email failed', error);
    return { sent: false, reason: 'failed' };
  }
}
