import 'server-only';

import { getGhlEmail } from '../ghl/email.ts';
import { getBuildSuiteReader } from '../buildsuite/projects.ts';
import { appUrl } from '../app-url.ts';
import type { TenantScope } from '../tenancy.ts';
import type { Project } from '../data/types.ts';
import { buildHomeownerEmail, type HomeownerEvent } from './homeowner-email.ts';

/**
 * Tell the homeowner something changed on their project.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS, AND WHAT IT REFUSES TO BE
 *
 * Until 14 Sep a PM could publish an update, send a change order or release a
 * message and the homeowner was never told. The blockers list carried it as
 * "NotifyClient only logs" for four days. This sends the email.
 *
 * Three rules, each the reason for a line below:
 *
 *   · Only client-facing text travels. The event carries the CLIENT SUMMARY of
 *     an update, the title and net figure of a change order, or the body of a
 *     message that was released. Internal notes, costs, margins and the field
 *     write-up are never passed in, so they cannot be emailed by mistake. The
 *     template module is pure and tested for exactly that.
 *   · It never throws into the action that called it. Publishing must succeed
 *     whether or not the mail goes; a failed email is logged, not surfaced as
 *     a failed publish.
 *   · It goes through the contractor's own GoHighLevel sub-account, like the
 *     invitation email, so a reply lands in the thread the contractor already
 *     uses. `GHL_SEND_EMAIL=true` is the kill switch that already gates every
 *     outbound email; `HUB_HOMEOWNER_EMAILS=off` additionally silences only
 *     these.
 * ---------------------------------------------------------------------------
 */
export async function notifyHomeowner(
  scope: TenantScope,
  project: Project,
  event: HomeownerEvent,
): Promise<{ sent: boolean; reason: string }> {
  try {
    if (process.env.HUB_HOMEOWNER_EMAILS === 'off') return { sent: false, reason: 'switched off' };
    // The portal master switch is the homeowner's door. Nothing is announced
    // to somebody who cannot open it.
    if (!project.clientPortalEnabled) return { sent: false, reason: 'portal off' };

    const mail = await getGhlEmail(scope.locationId);
    if (!mail.available) return { sent: false, reason: `email unconfigured: ${mail.missing.join(', ')}` };

    const reader = getBuildSuiteReader();
    const email = reader.available
      ? await reader.clientEmailForProject(scope, project.buildsuiteProjectId)
      : null;
    if (email === null) return { sent: false, reason: 'project has no client email' };

    const message = buildHomeownerEmail({
      event,
      projectName: project.projectName,
      projectCode: project.projectCode,
      clientName: project.clientName,
      signInUrl: `${await appUrl()}/signin`,
    });
    const result = await mail.email.send({
      email,
      name: project.clientName,
      subject: message.subject,
      html: message.html,
    });
    if (!result.sent) {
      // eslint-disable-next-line no-console
      console.warn(`[notify] homeowner email not sent (${result.reason}): ${result.detail}`);
      return { sent: false, reason: result.reason };
    }
    return { sent: true, reason: 'sent' };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[notify] homeowner email failed', error);
    return { sent: false, reason: 'error' };
  }
}
