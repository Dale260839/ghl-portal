import { NextResponse, type NextRequest } from 'next/server';

import {
  REFUSAL_REASON,
  readWebhookScheme,
  verifyInboundWebhook,
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
 * It verifies, routes, and logs. It does not execute or durably queue workflows.
 * Execution requires confirmed tenant/record mappings and approved durable
 * idempotency; a log line is not evidence of completed business work. Known
 * workflow events return 503 until that execution path exists.
 * ---------------------------------------------------------------------------
 */

export const dynamic = 'force-dynamic';

/**
 * No business effects are executed or queued yet, so this route must not mark
 * a routed delivery as processed or return a success acknowledgement for it.
 * A future executor requires durable idempotency, not a per-instance Set.
 */
const TIMESTAMP_HEADERS = ['x-ghl-timestamp', 'x-wh-timestamp', 'x-timestamp'];

function firstHeader(request: NextRequest, names: string[]): string | null {
  for (const name of names) {
    const value = request.headers.get(name);
    if (value !== null && value.trim() !== '') return value;
  }
  return null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Header and algorithm must agree. A failed current signature never falls
  // back to a legacy signature or a relay HMAC, even when both are supplied.
  const current = request.headers.get('x-ghl-signature');
  const legacy = request.headers.get('x-wh-signature');
  const relay = request.headers.get('x-signature');
  const requested = current !== null ? 'ghl-ed25519' : legacy !== null ? 'ghl' : relay !== null ? 'hmac' : undefined;
  const configured = readWebhookScheme(process.env, requested);
  if (configured.scheme === 'none') {
    // 503, not 401: this is our configuration missing, not their credential
    // failing. The distinction matters when someone is reading a delivery log
    // trying to work out whose problem it is.
    console.error(`[webhook] ${requested ?? 'any'} verification unconfigured`);
    return NextResponse.json({ ok: false, error: 'webhook_verification_unconfigured' }, { status: 503 });
  }

  // The RAW body. Signature is over the bytes that were sent — re-serialising a
  // parsed object would change them and break every signature.
  const rawBody = await request.text();

  const result = verifyInboundWebhook(
    {
      rawBody,
      signature: current ?? legacy ?? relay,
      timestamp: firstHeader(request, TIMESTAMP_HEADERS),
    },
    configured,
    new Date(),
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
    if (routing.reason === 'missing_location') {
      return NextResponse.json({ ok: false, handled: false, executed: false }, { status: 422 });
    }
    // 200, deliberately. GHL sends types we do not handle, and a 4xx here reads
    // as "this endpoint is broken" to whoever is watching deliveries — who then
    // disables it, and the events we DO handle stop arriving too.
    console.log(`[webhook] accepted, not routed — ${routing.why} (id ${result.event.id})`);
    return NextResponse.json({ ok: true, handled: false, executed: false });
  }

  console.log(
    `[webhook] ${result.event.type} → ${routing.workflow} — ${routing.why} ` +
      `(id ${result.event.id}, location ${result.event.locationId})`,
  );

  // No durable queue or executor: do not acknowledge completion. Sender retry
  // behavior must be verified in the owning app; this response is not recovery.
  console.error(`[webhook] ${routing.workflow} unavailable: no configured workflow executor`);
  return NextResponse.json(
    { ok: false, handled: false, executed: false, workflow: routing.workflow, error: 'workflow_execution_unavailable' },
    { status: 503 },
  );
}

/**
 * GHL asks for a 200 on GET when you register a URL. Answering says the endpoint
 * exists without revealing whether the secret is set — that is a POST concern.
 */
export function GET(): NextResponse {
  return NextResponse.json({ ok: true, endpoint: 'ghl-webhook' });
}
