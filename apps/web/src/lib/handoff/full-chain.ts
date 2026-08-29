import { evaluateGate, PUBLISHED_APPROVAL_STATUS } from '@buildsuite/contracts';

import { planFieldUpdateSubmitted, WF3 } from '../workflows/wf3-update-submitted.ts';
import { planFieldUpdateApproved, WF4 } from '../workflows/wf4-update-approved.ts';
import type { Effect } from '../workflows/effects.ts';
import { rehearseHandoff, type RehearsalInput, type RehearsalStage } from './rehearsal.ts';

/**
 * The whole loop, end to end, on synthetic data.
 *
 * `rehearsal.ts` stops at WF1 — a project exists. This carries on through the
 * part that has never run on anything real: a crew member submits an update, the
 * PM publishes it, and the homeowner sees it. That sequence is the spine of the
 * product and of the client walkthrough, and today there is no data that
 * exercises it, because nothing has ever been signed.
 *
 * ---------------------------------------------------------------------------
 * IT PROVES THE NEGATIVE TOO, AND THAT MATTERS MORE.
 *
 * A rehearsal that only shows the happy path proves the plumbing, not the
 * product. The invariant worth defending is the one that fails quietly:
 * `Approved Internally` is **not** approved for the client (§10). So step 8 runs
 * the gate twice — once at the internal status, expecting refusal, and once at
 * `Approved & Published`, expecting it through. If the refusal ever stops
 * happening, this reports the chain broken even though every step "succeeded".
 * ---------------------------------------------------------------------------
 *
 * Pure, like the handoff rehearsal: no network, no clock, no writes.
 */

export interface ChainStage extends RehearsalStage {}

export interface FullChainResult {
  stages: ChainStage[];
  /** Every stage the Hub owns completed, and the privacy negative held. */
  complete: boolean;
  blockedAt: ChainStage | null;
  /** Effects per workflow, so a reader can see what each step would create. */
  byWorkflow: { workflow: string; effects: Effect[] }[];
  /** The §9.1 checks, stated as outcomes rather than buried in a step. */
  privacy: {
    internalApprovalHidden: boolean;
    publishedApprovalVisible: boolean;
    unassociatedContactRefused: boolean;
  };
}

export interface FullChainInput extends RehearsalInput {
  /** The homeowner's contact id, for the gate. */
  clientContactId?: string;
  /** §6.1 master switch. Rehearsing it off is a legitimate case. */
  clientPortalEnabled?: boolean;
  today?: string;
}

const UPDATE_ID = 'update-rehearsal-1';

export function rehearseFullChain(input: FullChainInput): FullChainResult {
  const {
    clientContactId = 'ghl-contact-rehearsal',
    clientPortalEnabled = true,
    today = '2026-08-28',
  } = input;

  // ── Steps 1-5 · the handoff, unchanged and not duplicated ────────────────
  const handoff = rehearseHandoff(input);
  const stages: ChainStage[] = [...handoff.stages];
  const byWorkflow: { workflow: string; effects: Effect[] }[] = [];
  const privacy = {
    internalApprovalHidden: false,
    publishedApprovalVisible: false,
    unassociatedContactRefused: false,
  };

  if (!handoff.hubChainComplete) {
    return { stages, complete: false, blockedAt: handoff.blockedAt, byWorkflow, privacy };
  }
  byWorkflow.push({ workflow: 'WF1 New Project Setup', effects: handoff.effects });

  const projectId =
    handoff.effects.find((e) => e.type === 'CreateProject')?.buildsuiteProjectId ?? '';
  const projectName =
    handoff.effects.find((e) => e.type === 'CreateProject')?.projectName ?? 'the project';

  // ── 6 · The contractor sees it ───────────────────────────────────────────
  // Nothing to execute: the project exists and the dashboard reads projects.
  // Worth a step anyway, because "it appears on the dashboard" is the thing the
  // signed-only filter changes, and the rehearsal should say so.
  stages.push({
    step: 6,
    name: 'The contractor sees the project as signed work',
    owner: 'Hub',
    status: 'ok',
    detail:
      `${projectName} joins the projects list. With ENABLE_SIGNED_ONLY_FILTER on it survives ` +
      'the filter, because its deal is signed — which is the first time that filter shows anything.',
  });

  // ── 7 · A crew member submits an update ──────────────────────────────────
  const wf3 = planFieldUpdateSubmitted({
    buildsuiteProjectId: projectId,
    updateId: UPDATE_ID,
    submittedBy: 'Field crew (rehearsal)',
    projectName,
  });
  if (!wf3.ran) {
    const stage: ChainStage = {
      step: 7,
      name: `${WF3} runs`,
      owner: 'Hub',
      status: 'blocked',
      detail: wf3.skipped,
    };
    stages.push(stage);
    return { stages, complete: false, blockedAt: stage, byWorkflow, privacy };
  }
  byWorkflow.push({ workflow: WF3, effects: wf3.effects });
  stages.push({
    step: 7,
    name: 'A crew member submits a field update',
    owner: 'Hub',
    status: 'ok',
    detail: `${WF3} — ${wf3.effects.length} effect(s); it lands in the PM review queue, not the portal`,
  });

  // ── 8 · The PM publishes it, and the gate is checked BOTH ways ───────────
  const internal = evaluateGate(
    { clientVisible: false, managerApprovalStatus: 'Approved Internally', projectId },
    { clientPortalEnabled },
    { associatedProjectIds: [projectId] },
  );
  privacy.internalApprovalHidden = !internal.allowed;

  const wf4 = planFieldUpdateApproved({
    buildsuiteProjectId: projectId,
    updateId: UPDATE_ID,
    managerApprovalStatus: PUBLISHED_APPROVAL_STATUS,
    clientSummary: 'Framing finished on the north wall. Inspection booked for Tuesday.',
    contactId: clientContactId,
    projectName,
    today,
    clientPortalEnabled,
  });
  if (!wf4.ran) {
    const stage: ChainStage = {
      step: 8,
      name: `${WF4} runs`,
      owner: 'Hub',
      status: 'blocked',
      detail: wf4.skipped,
    };
    stages.push(stage);
    return { stages, complete: false, blockedAt: stage, byWorkflow, privacy };
  }
  byWorkflow.push({ workflow: WF4, effects: wf4.effects });
  stages.push({
    step: 8,
    name: 'The PM approves and publishes it',
    owner: 'Hub',
    status: 'ok',
    detail:
      `${WF4} — ${wf4.effects.length} effect(s). Checked both ways: at "Approved Internally" the ` +
      `gate ${privacy.internalApprovalHidden ? 'refuses' : 'ALLOWS — THIS IS A DEFECT'}.`,
  });

  // ── 9 · The homeowner sees it, and only it ───────────────────────────────
  const published = evaluateGate(
    { clientVisible: true, managerApprovalStatus: PUBLISHED_APPROVAL_STATUS, projectId },
    { clientPortalEnabled },
    { associatedProjectIds: [projectId] },
  );
  privacy.publishedApprovalVisible = published.allowed;

  // …and a homeowner on a different project must not, §1.4 notwithstanding.
  const stranger = evaluateGate(
    { clientVisible: true, managerApprovalStatus: PUBLISHED_APPROVAL_STATUS, projectId },
    { clientPortalEnabled },
    { associatedProjectIds: ['some-other-project'] },
  );
  privacy.unassociatedContactRefused = !stranger.allowed;

  const privacyHolds =
    privacy.internalApprovalHidden &&
    privacy.publishedApprovalVisible &&
    privacy.unassociatedContactRefused;

  const stage9: ChainStage = {
    step: 9,
    name: 'The homeowner sees the published update',
    owner: 'Hub',
    status: privacyHolds ? 'ok' : 'blocked',
    detail: privacyHolds
      ? 'the §9.1 gate allows the published update, refuses the internally-approved one, and ' +
        'refuses a contact associated with a different project'
      : 'the §9.1 gate did not behave as specified — see the privacy block',
  };
  stages.push(stage9);

  return {
    stages,
    complete: privacyHolds,
    blockedAt: privacyHolds ? null : stage9,
    byWorkflow,
    privacy,
  };
}

/** Plain-text report of the whole loop. */
export function formatFullChain(result: FullChainResult): string {
  const mark = { ok: '[ok]', blocked: '[BLOCKED]', 'not-ours': '[theirs]' } as const;
  const lines = result.stages.map(
    (s) => `${mark[s.status].padEnd(10)} ${s.step}. ${s.name} (${s.owner})\n${' '.repeat(13)}${s.detail}`,
  );

  lines.push('', 'Privacy checks (§9.1 / §10):');
  lines.push(`  ${result.privacy.internalApprovalHidden ? 'pass' : 'FAIL'}  "Approved Internally" is hidden from the client`);
  lines.push(`  ${result.privacy.publishedApprovalVisible ? 'pass' : 'FAIL'}  "Approved & Published" reaches the client`);
  lines.push(`  ${result.privacy.unassociatedContactRefused ? 'pass' : 'FAIL'}  a contact on another project is refused`);

  if (result.byWorkflow.length > 0) {
    lines.push('', 'What would be written:');
    for (const { workflow, effects } of result.byWorkflow) {
      lines.push(`  ${workflow} — ${effects.length} effect(s)`);
    }
  }
  return lines.join('\n');
}
