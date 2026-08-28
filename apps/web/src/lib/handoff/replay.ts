import { validateHandoffPayload, type HandoffPayload } from '@buildsuite/contracts';

import { isSignedWork, type Deal } from '../buildsuite/deals.ts';
import { planNewProjectSetup, type Wf1Trigger } from '../workflows/wf1-new-project.ts';
import type { WorkflowPlan } from '../workflows/effects.ts';
import { SHARED_KEY_FIELD } from './shared-key.ts';

/**
 * Replaying a signed deal through the whole chain, on synthetic data.
 *
 * ---------------------------------------------------------------------------
 * **Why this exists.** No deal has ever been signed
 * (`docs/kb/two-system-model.md`), so the day the first one is, nobody knows
 * whether the chain runs. This walks a deal through every step in order and
 * reports where it stops, so the first real signature is not also the first
 * test.
 *
 * **What it does NOT do.** It does not call BuildSuite, GoHighLevel, or the
 * database, and it never writes anything. The Hub does not build the handoff
 * payload in production either — BuildSuite writes it onto the GHL Contact at
 * Send-to-CRM (§8.2). Here we *construct* one from a deal purely to find out
 * which fields BuildSuite still has to send. That answer is the spec for Sing.
 * ---------------------------------------------------------------------------
 */

export type ReplayStepName =
  | 'deal_is_signed'
  | 'shared_key_present'
  | 'handoff_payload_complete'
  | 'handoff_payload_valid'
  | 'wf1_planned';

export interface ReplayStep {
  step: ReplayStepName;
  ok: boolean;
  detail: string;
}

export interface ReplayResult {
  steps: ReplayStep[];
  /** True only when every step passed. */
  completed: boolean;
  /** The first step that failed, or null when the chain ran end to end. */
  stoppedAt: ReplayStepName | null;
  /** Fields BuildSuite must supply that a `Deal` cannot provide. */
  missingFields: string[];
  /** The WF1 plan, when the chain got that far. */
  plan: WorkflowPlan | null;
}

/**
 * What BuildSuite must send at Send-to-CRM but a `Deal` row does not carry.
 *
 * Two of these are absent by our own choice: the deals reader deliberately does
 * not select `client_email` or `client_phone` (they are readable with a
 * publishable key, so the narrowest select is our half of that exposure). They
 * still have to reach GoHighLevel — from BuildSuite directly, not through us.
 */
export const FIELDS_DEAL_CANNOT_SUPPLY = [
  'project_address',
  'contract_amount',
  'client.email',
  'client.phone',
] as const;

export interface SuppliedFields {
  projectAddress?: string;
  contractAmount?: number;
  clientEmail?: string;
  clientPhone?: string;
  /** The shared key. Absent on every measured row — that is C-3. */
  sharedKey?: string;
}

/**
 * Builds the §8.2 payload a deal would produce, plus what is still missing.
 *
 * `supplied` stands in for the fields BuildSuite has and we do not. Passing
 * nothing shows the gap; passing all of them proves the chain.
 */
export function handoffFromDeal(
  deal: Deal,
  supplied: SuppliedFields = {},
): { payload: HandoffPayload; missing: string[] } {
  const missing: string[] = [];

  const sharedKey = supplied.sharedKey ?? deal.projectId ?? '';
  if (sharedKey === '') missing.push(SHARED_KEY_FIELD);
  if (supplied.projectAddress === undefined) missing.push('project_address');
  if (supplied.contractAmount === undefined) missing.push('contract_amount');
  if (supplied.clientEmail === undefined) missing.push('client.email');
  if (supplied.clientPhone === undefined) missing.push('client.phone');

  const payload: HandoffPayload = {
    buildsuite_project_id: sharedKey,
    // A deal has no project name of its own; the client and type is what
    // BuildSuite shows on the proposal, so it is the honest stand-in.
    project_name:
      deal.clientName !== '' && deal.projectType !== ''
        ? `${deal.clientName} — ${deal.projectType}`
        : deal.clientName || deal.projectType,
    project_address: supplied.projectAddress ?? '',
    contract_amount: supplied.contractAmount ?? 0,
    client: {
      name: deal.clientName,
      email: supplied.clientEmail ?? '',
      phone: supplied.clientPhone ?? '',
    },
  };

  return { payload, missing };
}

/**
 * Walks a deal through the chain and reports where it stops.
 *
 * Stops at the first failure rather than continuing, because every later step
 * depends on the earlier one and a cascade of failures hides the real cause.
 */
export function replaySignedDeal(
  deal: Deal,
  supplied: SuppliedFields = {},
  options: { projectExists?: boolean; projectManagerUserId?: string } = {},
): ReplayResult {
  const steps: ReplayStep[] = [];
  const stop = (missing: string[] = []): ReplayResult => ({
    steps,
    completed: false,
    stoppedAt: steps[steps.length - 1]?.step ?? null,
    missingFields: missing,
    plan: null,
  });

  // 1 — is it actually won?
  if (!isSignedWork(deal)) {
    steps.push({
      step: 'deal_is_signed',
      ok: false,
      detail: `deal ${deal.id} is at "${deal.stage}" with no signature and no handoff`,
    });
    return stop();
  }
  steps.push({
    step: 'deal_is_signed',
    ok: true,
    detail: deal.signed ? 'signature captured' : 'handoff fired without a captured signature',
  });

  // 2 — the shared key, before anything is built on it.
  const { payload, missing } = handoffFromDeal(deal, supplied);
  const keyPresent = payload.buildsuite_project_id !== '';
  steps.push({
    step: 'shared_key_present',
    ok: keyPresent,
    detail: keyPresent
      ? `${SHARED_KEY_FIELD} = ${payload.buildsuite_project_id}`
      : `no ${SHARED_KEY_FIELD} on the deal (C-3 undecided, and the column is empty on every row)`,
  });
  if (!keyPresent) return stop(missing);

  // 3 — did BuildSuite send everything §8.2 needs?
  const complete = missing.length === 0;
  steps.push({
    step: 'handoff_payload_complete',
    ok: complete,
    detail: complete
      ? 'every §8.2 field supplied'
      : `BuildSuite must also send: ${missing.join(', ')}`,
  });
  if (!complete) return stop(missing);

  // 4 — does it pass the contract?
  const issues = validateHandoffPayload(payload);
  steps.push({
    step: 'handoff_payload_valid',
    ok: issues.length === 0,
    detail:
      issues.length === 0
        ? 'payload satisfies §8.2'
        : issues.map((i) => `${i.field}: ${i.message}`).join('; '),
  });
  if (issues.length > 0) return stop(missing);

  // 5 — WF1 seeds the project.
  const trigger: Wf1Trigger = {
    opportunityId: deal.ghlOpportunityId ?? '',
    contactId: deal.ghlContactId ?? '',
    handoff: payload,
    projectExists: options.projectExists ?? false,
    ...(options.projectManagerUserId === undefined
      ? {}
      : { projectManagerUserId: options.projectManagerUserId }),
  };
  const plan = planNewProjectSetup(trigger);
  steps.push({
    step: 'wf1_planned',
    ok: plan.ran,
    detail: plan.ran
      ? `WF1 planned ${plan.effects.length} effect(s)`
      : `WF1 skipped: ${plan.skipped}`,
  });

  return {
    steps,
    completed: plan.ran,
    stoppedAt: plan.ran ? null : 'wf1_planned',
    missingFields: missing,
    plan,
  };
}

/** A one-screen summary of a replay, for an EOD note or the pipeline screen. */
export function describeReplay(result: ReplayResult): string {
  const lines = result.steps.map((s) => `${s.ok ? 'PASS' : 'STOP'}  ${s.step}: ${s.detail}`);
  lines.push(
    result.completed
      ? 'chain completed end to end'
      : `chain stopped at ${result.stoppedAt ?? 'unknown'}`,
  );
  return lines.join('\n');
}
