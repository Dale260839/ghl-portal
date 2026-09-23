import 'server-only';

import { cookies } from 'next/headers';

/**
 * Whether this browser has already been sent to connect recently.
 *
 * ---------------------------------------------------------------------------
 * WHY A MARKER IS NEEDED AT ALL
 *
 * A contractor whose sub-account is not connected is sent straight to
 * GoHighLevel's approval screen — no button of ours to press. That is the whole
 * point: connecting should not be a chore anybody performs, it should just
 * happen on the way in.
 *
 * But the flow can end without a connection: they close the tab, they decline,
 * GoHighLevel errors. If the next page view sent them again, someone who said
 * no would be sent round the same loop for ever, and a fault in the install
 * would become a browser that cannot reach the Hub at all. That is worse than
 * the problem being solved.
 *
 * So the attempt is remembered. Once. After that they see the banner, which
 * asks rather than insists, and they can choose their moment.
 *
 * SEVEN DAYS, NOT SEVEN MINUTES. The cost of asking again too soon is nagging
 * somebody who has already said no; the cost of waiting is a banner they can
 * click whenever they like. The second is the cheaper mistake.
 * ---------------------------------------------------------------------------
 */

const COOKIE = 'bs_connect_tried';
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export async function hasTriedConnecting(): Promise<boolean> {
  return (await cookies()).get(COOKIE)?.value === '1';
}

export async function markConnectAttempted(): Promise<void> {
  (await cookies()).set(COOKIE, '1', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

/** After a successful install there is nothing left to ask about. */
export async function clearConnectAttempt(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
