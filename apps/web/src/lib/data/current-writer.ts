import 'server-only';

import type { TenantScope } from '../tenancy.ts';
import { getHubOperational } from '../hub-db/operational.ts';
import type { DailyUpdate } from './types.ts';
import { activeSourceKind } from './source.ts';
import {
  approveInternally,
  createDraftUpdate,
  returnForRevision,
  saveClientSummary as saveFixtureSummary,
} from './mutations.ts';

/**
 * Where an operational write goes.
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM THIS SOLVES
 *
 * The field update form wrote to an in-memory fixture array while the read path
 * asked BuildSuite, which returned `[]`. The two were never connected — so on
 * live data, submitting an update did nothing visible, and on fixtures it
 * vanished on restart. The screens were real; the storage was not.
 *
 * There is now a real store, so writes go there. Fixtures remain the write
 * target only when fixtures are also what is being read, because a demo that
 * writes to a database it never reads from is the same bug in the other
 * direction.
 * ---------------------------------------------------------------------------
 *
 * One interface, deliberately small: only the operations a server action
 * actually performs. Growing it to mirror the whole repository would invite
 * screens to write through it rather than through a permission-checked action.
 */
export interface OperationalWriter {
  readonly persistent: boolean;

  createUpdate(
    scope: TenantScope,
    input: {
      projectId: string;
      submittedBy: string;
      workCompleted: string;
      crewOnsite: number;
      hoursWorked: number;
      weather: string;
      internalNotes: string;
      blocker?: string;
      clientDecisionNeeded?: boolean;
    },
  ): Promise<string>;

  saveClientSummary(scope: TenantScope, updateId: string, clientSummary: string): Promise<void>;

  setApproval(
    scope: TenantScope,
    updateId: string,
    status: DailyUpdate['managerApprovalStatus'],
    today: string,
  ): Promise<void>;

  returnForRevision(scope: TenantScope, updateId: string): Promise<void>;

  markTaskSeen(scope: TenantScope, taskId: string): Promise<void>;
  setTaskStatus(scope: TenantScope, taskId: string, status: string): Promise<void>;
}

/**
 * The fixture writer — the old behaviour, kept for the demo path only.
 *
 * `persistent: false` is not decoration. A screen can say "this will not
 * survive a restart" rather than letting someone discover it, which is the
 * difference between a known limitation and a bug report.
 */
class FixtureWriter implements OperationalWriter {
  readonly persistent = false;

  async createUpdate(
    _scope: TenantScope,
    input: Parameters<OperationalWriter['createUpdate']>[1],
  ): Promise<string> {
    return createDraftUpdate(
      {
        projectId: input.projectId,
        submittedBy: input.submittedBy,
        workCompleted: input.workCompleted,
        internalNotes: input.internalNotes,
        clientSummary: '',
        crewOnsite: input.crewOnsite,
        hoursWorked: input.hoursWorked,
        weather: input.weather,
      },
      new Date().toISOString().slice(0, 10),
    );
  }

  async saveClientSummary(_scope: TenantScope, id: string, summary: string): Promise<void> {
    saveFixtureSummary(id, summary);
  }

  async setApproval(
    _scope: TenantScope,
    id: string,
    status: DailyUpdate['managerApprovalStatus'],
    _today: string,
  ): Promise<void> {
    // The fixture path only ever had an "approve internally" transition; the
    // published one is applied by the workflow ports. Kept narrow rather than
    // widened, because this path is on its way out.
    if (status === 'Approved Internally') approveInternally(id, '');
  }

  async returnForRevision(_scope: TenantScope, id: string): Promise<void> {
    returnForRevision(id);
  }

  // Fixture tasks are mutated in place by the field screens themselves.
  async markTaskSeen(): Promise<void> {}
  async setTaskStatus(): Promise<void> {}
}

class HubWriter implements OperationalWriter {
  readonly persistent = true;

  constructor(private readonly ops: NonNullable<ReturnType<typeof hubOps>>) {}

  async createUpdate(
    scope: TenantScope,
    input: Parameters<OperationalWriter['createUpdate']>[1],
  ): Promise<string> {
    const update = await this.ops.createUpdate(scope, input);
    return update.id;
  }

  saveClientSummary(scope: TenantScope, id: string, summary: string): Promise<void> {
    return this.ops.saveClientSummary(scope, id, summary);
  }

  setApproval(
    scope: TenantScope,
    id: string,
    status: DailyUpdate['managerApprovalStatus'],
    today: string,
  ): Promise<void> {
    return this.ops.setApproval(scope, id, status, today);
  }

  returnForRevision(scope: TenantScope, id: string): Promise<void> {
    // Returning for revision is a state, not a separate table.
    return this.ops.setApproval(scope, id, 'Pending', '');
  }

  markTaskSeen(scope: TenantScope, taskId: string): Promise<void> {
    return this.ops.markTaskSeen(scope, taskId);
  }

  setTaskStatus(scope: TenantScope, taskId: string, status: string): Promise<void> {
    return this.ops.setTaskStatus(scope, taskId, status);
  }
}

function hubOps() {
  const hub = getHubOperational();
  return hub.available ? hub.ops : null;
}

export function currentWriter(): OperationalWriter {
  // Fixtures read and write as one system. Writing to the Hub while reading
  // fixtures would put an update somewhere the screen never looks.
  if (activeSourceKind() === 'fixture') return new FixtureWriter();

  const ops = hubOps();
  return ops === null ? new FixtureWriter() : new HubWriter(ops);
}
