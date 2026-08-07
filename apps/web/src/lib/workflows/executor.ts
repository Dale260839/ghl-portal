import type { Effect, WorkflowPlan } from './effects.ts';
import type { EffectHandlers } from './ports.ts';

/**
 * Applies a plan's effects through the supplied handlers.
 *
 * Stops at the first failure and reports what was already applied. For an
 * unattended job that matters more than it looks: "WF1 failed" is not actionable,
 * but "WF1 created the project and associated the contact, then failed seeding
 * milestones" tells you exactly what a retry must not repeat.
 *
 * Effects are applied **in order**, sequentially. The planners emit them in
 * dependency order — CreateProject before AssociateContact — so parallelising
 * would break projects that don't exist yet.
 */

export type ExecutionResult =
  | { status: 'skipped'; workflow: string; reason: string }
  | { status: 'ok'; workflow: string; applied: Effect[] }
  | {
      status: 'failed';
      workflow: string;
      applied: Effect[];
      failedOn: Effect;
      error: Error;
    };

export async function execute(
  plan: WorkflowPlan,
  handlers: EffectHandlers,
): Promise<ExecutionResult> {
  if (!plan.ran) {
    return { status: 'skipped', workflow: plan.workflow, reason: plan.skipped };
  }

  const applied: Effect[] = [];

  for (const effect of plan.effects) {
    const handler = handlers[effect.type] as (e: Effect) => void | Promise<void>;
    try {
      await handler(effect);
      applied.push(effect);
    } catch (cause) {
      return {
        status: 'failed',
        workflow: plan.workflow,
        applied,
        failedOn: effect,
        error: cause instanceof Error ? cause : new Error(String(cause)),
      };
    }
  }

  return { status: 'ok', workflow: plan.workflow, applied };
}

/** One-line summary for logs. Never includes effect payloads — they carry
 *  project data, and workflow logs are not a client-facing boundary but they
 *  are read by people who don't need vendor costs in their terminal. */
export function describe(result: ExecutionResult): string {
  switch (result.status) {
    case 'skipped':
      return `${result.workflow}: skipped — ${result.reason}`;
    case 'ok':
      return `${result.workflow}: applied ${result.applied.length} effect(s)`;
    case 'failed':
      return `${result.workflow}: FAILED on ${result.failedOn.type} after ${result.applied.length} effect(s) — ${result.error.message}`;
  }
}
