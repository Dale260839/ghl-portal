/**
 * §9.4 — what a field user must never see.
 *
 * The list is short and every item on it is a way to embarrass a contractor in
 * front of their own crew: profit, markups, internal financial reports, client
 * payment details, unassigned projects, private client messages, employee
 * records, company-wide administration.
 *
 * The money tests assert the property is **absent**, not zero. A field session
 * that receives `margin: 0` still received a margin field, and the next
 * developer who renders a project object gets it for free. Same argument as the
 * client projections in Phase B.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fieldMessages,
  isUnseen,
  projectsForField,
  tasksForField,
  toFieldProject,
  unseenCount,
  assignedProjectIds,
  visibleProjectIds,
} from './field-data.ts';
import { PROJECTS, TASKS } from './data/fixtures.ts';
import { MESSAGES } from './data/portal-fixtures.ts';

const TONY = 'Tony Alvarez';

// ── §9.4 · money ─────────────────────────────────────────────────────────────

test('§9.4 a field project has no money property at all', () => {
  const mine = projectsForField(PROJECTS, assignedProjectIds(TASKS, TONY));
  assert.ok(mine.length > 0, 'the field user must have projects for this to prove anything');

  const banned = [
    'contractAmount',
    'currentProjectTotal',
    'amountInvoiced',
    'amountPaid',
    'remainingBalance',
    'nextPaymentAmount',
    'nextPaymentDueDate',
    'originalEstimate',
    'internalMarkup',
    'margin',
    'approvedChangeOrders',
    'pendingChangeOrders',
    'budgetBand',
  ];

  for (const project of mine) {
    for (const field of banned) {
      assert.equal(
        field in project,
        false,
        `${project.projectName} still carries ${field} — §9.4 forbids it on a field session`,
      );
    }
  }
});

test('§9.4 the source project really does carry those values', () => {
  // Otherwise the test above passes for the wrong reason.
  const source = PROJECTS.find((p) => p.superintendent === TONY);
  assert.ok(source);
  assert.ok(source.contractAmount > 0, 'fixture should have a contract amount to strip');
  assert.equal('margin' in source, true);
});

test('§9.4 no key on a field project even looks financial', () => {
  // Catches a future field named `vendorCost` or `profitPercent` that nobody
  // remembered to add to the Omit.
  const [project] = projectsForField(PROJECTS, assignedProjectIds(TASKS, TONY));
  assert.ok(project);

  for (const key of Object.keys(project)) {
    // Dates are exempt by name: `estimatedStartDate` is a schedule field the
    // crew needs, and matching it on "estimate" would be a false positive that
    // teaches people to loosen the check.
    if (key.endsWith('Date')) continue;

    assert.equal(
      /cost|margin|markup|profit|invoice|payment|balance|amount|budget|originalEstimate/i.test(key),
      false,
      `field project exposes "${key}"`,
    );
  }
});

// ── §9.4 · unassigned projects ───────────────────────────────────────────────

test('§9.4 a field user sees only the projects they are on', () => {
  // "On a project" means holding a task on it. NOT being named its
  // superintendent: that was a §3.6 name match, and on live BuildSuite rows
  // `superintendent` is empty on every single one, so keying off it showed a
  // crew member nothing at all.
  const assigned = assignedProjectIds(TASKS, TONY);
  const mine = projectsForField(PROJECTS, assigned);
  const others = PROJECTS.filter((p) => !assigned.includes(p.buildsuiteProjectId));

  assert.ok(others.length > 0, 'fixtures must include a project this user is not on');
  assert.deepEqual(
    mine.map((p) => p.buildsuiteProjectId).sort(),
    [...assigned].sort(),
    'the visible set is exactly the assigned set — no more, no fewer',
  );

  const mineIds = new Set(mine.map((p) => p.buildsuiteProjectId));
  for (const other of others) {
    assert.equal(mineIds.has(other.buildsuiteProjectId), false, 'an unassigned project leaked');
  }
});

test('being named superintendent is not what grants access', () => {
  // Guards the regression directly. Tony is superintendent of a project he
  // holds no task on; it must not appear.
  const assigned = assignedProjectIds(TASKS, TONY);
  const suptOnly = PROJECTS.filter(
    (p) => p.superintendent === TONY && !assigned.includes(p.buildsuiteProjectId),
  );
  assert.ok(suptOnly.length > 0, 'fixtures must separate the two ideas for this to prove anything');

  const shown = new Set(
    projectsForField(PROJECTS, assigned).map((p) => p.buildsuiteProjectId),
  );
  for (const p of suptOnly) {
    assert.equal(shown.has(p.buildsuiteProjectId), false, 'a name match granted access');
  }
});

test('an unknown field user sees nothing rather than everything', () => {
  // Fail closed: a name that matches nobody must not fall through to "all".
  assert.deepEqual(projectsForField(PROJECTS, assignedProjectIds(TASKS, 'membership-nobody')), []);
  assert.deepEqual(projectsForField(PROJECTS, assignedProjectIds(TASKS, '')), []);
});

// ── Assignment, and the ding (D4 §5) ─────────────────────────────────────────

test('only tasks assigned to this person are returned', () => {
  const mine = projectsForField(PROJECTS, assignedProjectIds(TASKS, TONY));
  const tasks = tasksForField(TASKS, mine, TONY);

  assert.ok(tasks.length > 0);
  for (const task of tasks) {
    assert.equal(task.assignedTo, TONY);
  }

  // The fixtures hold unassigned tasks precisely so this excludes something.
  assert.ok(TASKS.some((t) => t.assignedTo === null), 'fixtures need an unassigned task');
});

test('a task assigned to me on a project I am not on is still not shown', () => {
  const assigned = assignedProjectIds(TASKS, TONY);
  const foreign = PROJECTS.find((p) => !assigned.includes(p.buildsuiteProjectId));
  assert.ok(foreign);

  const stray = {
    ...TASKS[0]!,
    id: 'task-stray',
    projectId: foreign.buildsuiteProjectId,
    assignedTo: TONY,
  };

  const mine = projectsForField(PROJECTS, assigned);
  const shown = tasksForField([...TASKS, stray], mine, TONY).map((t) => t.id);

  assert.equal(shown.includes('task-stray'), false, 'both conditions must hold, not either');
});

test('the ding counts unseen assignments only', () => {
  const mine = projectsForField(PROJECTS, assignedProjectIds(TASKS, TONY));
  const tasks = tasksForField(TASKS, mine, TONY);

  const expected = tasks.filter((t) => t.seenAt === null).length;
  assert.equal(unseenCount(tasks), expected);
  assert.ok(expected > 0, 'fixtures should leave something unseen so the badge is demonstrable');

  for (const task of tasks) {
    assert.equal(isUnseen(task), task.seenAt === null);
  }
});

test('newest assignment sorts first', () => {
  const mine = projectsForField(PROJECTS, assignedProjectIds(TASKS, TONY));
  const tasks = tasksForField(TASKS, mine, TONY);

  for (let i = 1; i < tasks.length; i++) {
    assert.ok(
      tasks[i - 1]!.assignedAt >= tasks[i]!.assignedAt,
      'a fresh ding must be at the top of the screen',
    );
  }
});

// ── §9.4 · private client messages ───────────────────────────────────────────

test('§9.4 the field thread contains nothing the client can see', () => {
  const mine = projectsForField(PROJECTS, assignedProjectIds(TASKS, TONY));
  const ids = new Set(mine.map((p) => p.buildsuiteProjectId));
  const thread = fieldMessages(MESSAGES, ids);

  for (const message of thread) {
    assert.equal(message.clientVisible, false, 'a client-visible message reached the crew');
    assert.equal(message.fromClient, false, 'the crew can read what the homeowner wrote');
  }
});

test('§9.4 the field thread contains nothing from another crew’s project', () => {
  const mine = projectsForField(PROJECTS, assignedProjectIds(TASKS, TONY));
  const ids = new Set(mine.map((p) => p.buildsuiteProjectId));

  for (const message of fieldMessages(MESSAGES, ids)) {
    assert.equal(ids.has(message.projectId), true);
  }
});

test('an empty project set yields an empty thread', () => {
  assert.deepEqual(fieldMessages(MESSAGES, new Set()), []);
});

// ── The projection is total ──────────────────────────────────────────────────

test('toFieldProject keeps everything a crew member actually needs', () => {
  const source = PROJECTS.find((p) => p.superintendent === TONY)!;
  const field = toFieldProject(source);

  for (const kept of [
    'buildsuiteProjectId',
    'projectName',
    'projectAddress',
    'projectType',
    'clientName',
    'superintendent',
    'estimatedCompletionDate',
  ] as const) {
    assert.equal(kept in field, true, `${kept} should survive the projection`);
  }
});

// ── Assignment comes from two places (2026-09-01) ────────────────────────────

test('a crew member sees projects assigned to them even with no tasks yet', () => {
  // The gap that made every real invitation land on an empty screen: access was
  // derived from tasks alone, and a freshly invited person holds none.
  const target = PROJECTS[0]!.buildsuiteProjectId;
  const ids = visibleProjectIds([target], assignedProjectIds(TASKS, 'membership-nobody'));

  assert.deepEqual(
    projectsForField(PROJECTS, ids).map((p) => p.buildsuiteProjectId),
    [target],
  );
});

test('the two sources union rather than replace each other', () => {
  const fromTasks = assignedProjectIds(TASKS, TONY);
  const extra = PROJECTS.find((p) => !fromTasks.includes(p.buildsuiteProjectId));
  assert.ok(extra);

  const ids = visibleProjectIds([extra.buildsuiteProjectId], fromTasks);
  for (const id of fromTasks) assert.ok(ids.includes(id), 'a task assignment was dropped');
  assert.ok(ids.includes(extra.buildsuiteProjectId), 'an explicit assignment was dropped');
});

test('assigned nothing and holding nothing still means nothing', () => {
  // There must be no value of `assigned` that means "everything".
  assert.deepEqual(projectsForField(PROJECTS, visibleProjectIds([], [])), []);
});

test('an assignment to a project that is not ours grants nothing', () => {
  // The ids are validated on the way in, but the read must not depend on that.
  const ids = visibleProjectIds(['BSP-NOT-OURS-0001'], []);
  assert.deepEqual(projectsForField(PROJECTS, ids), []);
});
