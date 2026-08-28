import { planNewProjectSetup, WF1 } from '../workflows/wf1-new-project.ts';
import type { Effect } from '../workflows/effects.ts';
import { routeWebhook } from '../ghl/webhook-routing.ts';
import type { WebhookEvent } from '../ghl/webhook.ts';
import type { Deal } from '../buildsuite/deals.ts';
import { buildHandoffFromDeal, gapsByOwner, type HandoffProjectFacts } from './from-deal.ts';

/**
 * Replaying a signed deal through the whole chain, without a signed deal.
 *
 * Nothing has ever been signed — 0 of 182 — so the first real signature would
 * otherwise be spent debugging. This runs the sequence end to end on a synthetic
 * deal and reports where it stops.
 *
 * **It proves our half and says so.** Steps 1-2 are BuildSuite's and step 3 is
 * GoHighLevel's; this rehearses them as assertions about what must arrive, not
 * as things we perform. Steps 4-5 are ours and are genuinely executed — the same
 * router and the same planner the live path uses, not a copy.
 *
 * It is deliberately **pure**: no network, no clock, no writes. A rehearsal that
 * touched a live system would be the one thing worse than no rehearsal.
 */

export type StageStatus = 'ok' | 'blocked' | 'not-ours';

export interface RehearsalStage {
  step: number;
  name: string;
  owner: 'BuildSuite' | 'GoHighLevel' | 'Hub';
  status: StageStatus;
  detail: string;
}

export interface RehearsalResult {
  stages: RehearsalStage[];
  /** True when every stage the Hub owns completed. */
  hubChainComplete: boolean;
  /** The first stage that stopped the run, if any. */
  blockedAt: RehearsalStage | null;
  /** WF1's effects, when it got far enough to plan them. */
  effects: Effect[];
  /** A count per effect type — what would actually be created. */
  effectSummary: { type: string; count: number }[];
}

export interface RehearsalInput {
  deal: Deal;
  project: HandoffProjectFacts;
  /** The GHL event that would notify us. Defaults to the mapped handoff event. */
  eventType?: string;
  locationId?: string | null;
  contactId?: string;
  opportunityId?: string;
  projectManagerUserId?: string;
  /** True to rehearse the second delivery of the same handoff. */
  projectExists?: boolean;
}

function summarize(effects: Effect[]): { type: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const effect of effects) counts.set(effect.type, (counts.get(effect.type) ?? 0) + 1);
  return [...counts].map(([type, count]) => ({ type, count }));
}

export function rehearseHandoff(input: RehearsalInput): RehearsalResult {
  const {
    deal,
    project,
    eventType = 'ProjectHandoffReceived',
    locationId = 'IifYfP2B2NUaoDPdsTTa',
    contactId = 'ghl-contact-rehearsal',
    opportunityId = 'ghl-opportunity-rehearsal',
    projectManagerUserId,
    projectExists = false,
  } = input;

  const stages: RehearsalStage[] = [];
  let effects: Effect[] = [];

  // ── 1 · BuildSuite captures the signature ─────────────────────────────────
  const signed = deal.signed || deal.sentToCrm;
  stages.push({
    step: 1,
    name: 'Signature captured in BuildSuite',
    owner: 'BuildSuite',
    status: signed ? 'not-ours' : 'blocked',
    detail: signed
      ? 'signature_signed_at or sent_to_crm_at is set — this is the moment the chain starts'
      : 'the deal is not signed, so nothing downstream can run. This is the real blocker: 0 of 182 deals.',
  });
  if (!signed) {
    return { stages, hubChainComplete: false, blockedAt: stages[0], effects, effectSummary: [] };
  }

  // ── 2 · Send-to-CRM assembles the §8.2 payload ────────────────────────────
  const attempt = buildHandoffFromDeal(deal, project);
  if (!attempt.ok) {
    const byOwner = gapsByOwner(attempt.gaps);
    const stage: RehearsalStage = {
      step: 2,
      name: 'Send-to-CRM assembles the §8.2 handoff',
      owner: 'BuildSuite',
      status: 'blocked',
      detail:
        `${attempt.gaps.length} field(s) cannot be supplied: ` +
        attempt.gaps.map((g) => g.field).join(', ') +
        `. ${byOwner.decision.length} need a decision, ${byOwner.BuildSuite.length} need BuildSuite.`,
    };
    stages.push(stage);
    return { stages, hubChainComplete: false, blockedAt: stage, effects, effectSummary: [] };
  }
  stages.push({
    step: 2,
    name: 'Send-to-CRM assembles the §8.2 handoff',
    owner: 'BuildSuite',
    status: 'not-ours',
    detail: `payload valid — shared key ${attempt.payload.buildsuite_project_id}`,
  });

  // ── 3 · GHL creates the record and notifies us ────────────────────────────
  stages.push({
    step: 3,
    name: 'GoHighLevel creates the Project and fires a webhook',
    owner: 'GoHighLevel',
    status: 'not-ours',
    detail:
      'needs the Project custom object (tier unconfirmed) and the webhook secret. ' +
      'The receiver already verifies signature, timestamp and replay.',
  });

  // ── 4 · The Hub routes it. Real router, not a stand-in. ───────────────────
  const event: WebhookEvent = {
    id: 'rehearsal-event',
    type: eventType,
    locationId,
    raw: {},
  };
  const routing = routeWebhook(event);
  const routedToWf1 = routing.handled && routing.workflow === 'WF1';
  const routeStage: RehearsalStage = {
    step: 4,
    name: 'The Hub routes the webhook to WF1',
    owner: 'Hub',
    status: routedToWf1 ? 'ok' : 'blocked',
    detail: routedToWf1 ? `"${eventType}" → WF1` : routing.why,
  };
  stages.push(routeStage);
  if (!routedToWf1) {
    return { stages, hubChainComplete: false, blockedAt: routeStage, effects, effectSummary: [] };
  }

  // ── 5 · WF1 plans the setup. Real planner. ────────────────────────────────
  const plan = planNewProjectSetup({
    opportunityId,
    contactId,
    handoff: attempt.payload,
    projectManagerUserId,
    projectExists,
  });

  if (!plan.ran) {
    const stage: RehearsalStage = {
      step: 5,
      name: `${WF1} plans the project`,
      owner: 'Hub',
      status: 'blocked',
      detail: plan.skipped,
    };
    stages.push(stage);
    return { stages, hubChainComplete: false, blockedAt: stage, effects, effectSummary: [] };
  }

  effects = plan.effects;
  stages.push({
    step: 5,
    name: `${WF1} plans the project`,
    owner: 'Hub',
    status: 'ok',
    detail: projectExists
      ? `${effects.length} effect(s) — the handoff arrived twice and seeding was skipped`
      : `${effects.length} effects — milestones, tasks, progress, portal access`,
  });

  return {
    stages,
    hubChainComplete: true,
    blockedAt: null,
    effects,
    effectSummary: summarize(effects),
  };
}

/** Plain-text report, for a terminal or a hand-off note. */
export function formatRehearsal(result: RehearsalResult): string {
  const mark: Record<StageStatus, string> = { ok: '[ok]', blocked: '[BLOCKED]', 'not-ours': '[theirs]' };
  const lines = result.stages.map(
    (s) => `${mark[s.status].padEnd(10)} ${s.step}. ${s.name} (${s.owner})\n${' '.repeat(13)}${s.detail}`,
  );

  if (result.hubChainComplete) {
    lines.push('', 'WF1 would create:');
    for (const { type, count } of result.effectSummary) {
      lines.push(`  ${String(count).padStart(3)} x ${type}`);
    }
  }
  return lines.join('\n');
}
