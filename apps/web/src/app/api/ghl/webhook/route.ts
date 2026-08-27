import { NextResponse, type NextRequest } from 'next/server';

import {
  REFUSAL_REASON,
  createSeenStore,
  readWebhookConfig,
  verifyWebhook,
} from '@/lib/ghl/webhook';
import { routeWebhook } from '@/lib/ghl/webhook-routing';

/**
 * GoHighLevel workflow webhook (D4 §3 — the third wire).
 *
 * D4: *"custom values alone do not trigger anything. GHL must be told to notify
 * the Hub via webhook when values change. So firing = webhook + key."* This is
 * the endpoint that gets told.
 *
 * The decisions live in `lib/ghl/webhook.ts` and `webhook-routing.ts`, both
 * pure, so this file only reads the request and answers. Everything it refuses,
 * it refuses before parsing.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT DO YET, and why that is deliberate.
 *
 * It verifies, routes, and logs. It does **not** execute the planner. Two
 * reasons: the planners need real GHL record data to build a trigger from, and
 * reading GHL needs the object key we do not have. Executing against a payload
 * shape nobody has seen would be guessing.
 *
 * So this ships the half that is knowable — is this really GHL, and what does it
 * mean — and stops at the seam. The first real delivery tells us the rest.
 * ---------------------------------------------------------------------------
 */

export const dynamic = 'force-dynamic';

/**
 * Replay protection, per instance. See the note in `webhook.ts`: serverless
 * means several of these, so the durable guarantee is the timestamp window and
 * this narrows it further on a warm instance.
 */
const seen = createSeenStore();

/** Headers GHL might use. Checked in order; the first present one wins. */
const SIGNATURE_HEADERS = ['x-ghl-signature', 'x-wh-signature', 'x-signature'];
const TIMESTAMP_HEADERS = ['x-ghl-timestamp', 'x-wh-timestamp', 'x-timestamp'];

function firstHeader(request: NextRequest, names: string[]): string | null {
  for (const name of names) {
    const value = request.headers.get(name);
    if (value !== null && value.trim() !== '') return value;
  }
  return null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const configured = readWebhookConfig();
  if (!configured.configured) {
    // 503, not 401: this is our configuration missing, not their credential
    // failing. The distinction matters when someone is reading a delivery log
    // trying to work out whose problem it is.
    console.error(`[webhook] ${REFUSAL_REASON.not_configured}`);
    return NextResponse.json({ ok: false, error: REFUSAL_REASON.not_configured }, { status: 503 });
  }

  // The RAW body. Signature is over the bytes that were sent — re-serialising a
  // parsed object would change them and break every signature.
  const rawBody = await request.text();

  const result = verifyWebhook(
    {
      rawBody,
      signature: firstHeader(request, SIGNATURE_HEADERS),
      timestamp: firstHeader(request, TIMESTAMP_HEADERS),
    },
    configured.config,
    new Date(),
    seen,
  );

  if (!result.ok) {
    console.warn(`[webhook] refused: ${result.reason} — ${REFUSAL_REASON[result.reason]}`);
    // One status for every refusal, and no detail in the body. Telling an
    // unauthenticated caller *which* check they failed helps them pass it next
    // time. The log has the detail; the response does not.
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const routing = routeWebhook(result.event);

  if (!routing.handled) {
    // 200, deliberately. GHL sends types we do not handle, and a 4xx here reads
    // as "this endpoint is broken" to whoever is watching deliveries — who then
    // disables it, and the events we DO handle stop arriving too.
    console.log(`[webhook] accepted, not routed — ${routing.why} (id ${result.event.id})`);
    return NextResponse.json({ ok: true, handled: false });
  }

  console.log(
    `[webhook] ${result.event.type} → ${routing.workflow} — ${routing.why} ` +
      `(id ${result.event.id}, location ${result.event.locationId})`,
  );

  // The seam. Executing the planner needs the GHL record behind this event, and
  // reading it needs the object key. Logged rather than dropped so the first
  // real delivery is visible in the terminal.
  console.log(`[webhook] ${routing.workflow} not executed — awaiting GHL_PROJECT_OBJECT_KEY`);

  return NextResponse.json({ ok: true, handled: true, workflow: routing.workflow });
}

/**
 * GHL asks for a 200 on GET when you register a URL. Answering says the endpoint
 * exists without revealing whether the secret is set — that is a POST concern.
 */
export function GET(): NextResponse {
  return NextResponse.json({ ok: true, endpoint: 'ghl-webhook' });
}
