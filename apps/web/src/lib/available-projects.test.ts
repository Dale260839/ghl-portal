import assert from 'node:assert/strict';
import test from 'node:test';

import {
  availableProjects,
  availableProjectsBanner,
  isAvailableProject,
  isAvailableStage,
  isSignedOrWon,
  summarizeAvailable,
} from './available-projects.ts';
import type { ProjectSigning } from './signed-work.ts';
import type { Project } from './data/types.ts';
import type { Proposal } from './buildsuite/proposals.ts';

/**
 * Which projects reach the Projects screen.
 *
 * The rule is two conditions — a live stage (`awarded` or `active`), and a
 * proposal that is signed or won — and the cases that matter are the ones where
 * only ONE holds. Both exist in the live data, which is why the rule is both.
 */

function row(over: {
  sourceStatus?: string;
  signed?: boolean;
  proposalStatus?: string;
  noProposal?: boolean;
  code?: string;
}): ProjectSigning {
  const project = {
    buildsuiteProjectId: over.code ?? 'BSA-001',
    sourceStatus: over.sourceStatus,
  } as unknown as Project;

  if (over.noProposal === true) return { project, status: 'unknown', proposal: null };

  const proposal = {
    id: 'pr-1',
    projectId: project.buildsuiteProjectId,
    status: over.proposalStatus ?? 'submitted',
    signed: over.signed === true,
  } as unknown as Proposal;

  return { project, status: over.signed === true ? 'signed' : 'unsigned', proposal };
}

// ── The stage half ───────────────────────────────────────────────────────────

test('awarded AND active both pass; the other four stages do not', () => {
  // The live vocabulary is matched · active · draft · new · awarded · completed.
  assert.equal(isAvailableStage({ sourceStatus: 'awarded' }), true);
  assert.equal(isAvailableStage({ sourceStatus: 'active' }), true);

  for (const stage of ['draft', 'matched', 'new', 'completed']) {
    assert.equal(isAvailableStage({ sourceStatus: stage }), false, `${stage} passed`);
  }
  assert.equal(isAvailableStage({ sourceStatus: undefined }), false);
});

test('completed is excluded on purpose, not by omission', () => {
  // Finished work belongs on the archive, not on the list of what a contractor
  // is running today. Pinned so widening the list is a decision, not a slip.
  assert.equal(isAvailableStage({ sourceStatus: 'completed' }), false);
});

test('the stage word survives being capitalised or padded', () => {
  // A free-text column on somebody else's database. An exact-match check is how
  // this screen empties itself the day the value arrives with a capital A.
  for (const value of ['Awarded', 'AWARDED', '  awarded  ', 'aWaRdEd', 'Active', ' ACTIVE ']) {
    assert.equal(
      isAvailableStage({ sourceStatus: value }),
      true,
      `rejected ${JSON.stringify(value)}`,
    );
  }
});

// ── The money half ───────────────────────────────────────────────────────────

test('signed and won both count, and neither requires the other', () => {
  // Measured 2026-09-12: `accepted` and `SIGNED` are the same 8 proposals, so
  // these never disagree today. The day they do is a won job whose paperwork
  // has not caught up, and that is the worst moment to drop it off the list.
  assert.equal(isSignedOrWon(row({ signed: true, proposalStatus: 'submitted' })), true);
  assert.equal(isSignedOrWon(row({ signed: false, proposalStatus: 'accepted' })), true);
  assert.equal(isSignedOrWon(row({ signed: false, proposalStatus: 'won' })), true);
});

test('a quoted or draft proposal is not agreement', () => {
  for (const status of ['draft', 'submitted', 'rejected', '']) {
    assert.equal(
      isSignedOrWon(row({ signed: false, proposalStatus: status })),
      false,
      `${status} counted as agreement`,
    );
  }
});

test('no proposal at all is not agreement', () => {
  // There is nobody's price on it to have agreed to.
  assert.equal(isSignedOrWon(row({ noProposal: true })), false);
});

// ── Both, and why neither alone ──────────────────────────────────────────────

test('a live stage AND agreement shows; either one alone does not', () => {
  assert.equal(isAvailableProject(row({ sourceStatus: 'awarded', signed: true })), true);
  assert.equal(isAvailableProject(row({ sourceStatus: 'active', signed: true })), true);

  // Stage alone. This is the case that matters most now: 43 live projects are
  // `active` and 42 of them are this row, held back only by the money half.
  assert.equal(isAvailableProject(row({ sourceStatus: 'active', signed: false })), false);
  assert.equal(isAvailableProject(row({ sourceStatus: 'awarded', signed: false })), false);

  // Agreement alone — a signed proposal on a project at a stage that is not live.
  assert.equal(isAvailableProject(row({ sourceStatus: 'draft', signed: true })), false);
  assert.equal(isAvailableProject(row({ sourceStatus: 'completed', signed: true })), false);
});

test('the live shape, reproduced', () => {
  // 2026-09-12, what the database actually holds across every tenant: three
  // awarded-and-signed, BSA-052 active-and-signed, and an active project with
  // no proposal standing in for the forty-two of those.
  const rows = [
    row({ code: 'BSA-APS-001', sourceStatus: 'awarded', signed: true, proposalStatus: 'accepted' }),
    row({ code: 'BSA-APS-002', sourceStatus: 'awarded', signed: true, proposalStatus: 'accepted' }),
    row({ code: 'BSA-053', sourceStatus: 'awarded', signed: true, proposalStatus: 'accepted' }),
    row({ code: 'BSA-052', sourceStatus: 'active', signed: true, proposalStatus: 'accepted' }),
    row({ code: 'BSA-044', sourceStatus: 'active', noProposal: true }),
    row({ code: 'BSA-999', sourceStatus: 'draft', noProposal: true }),
  ];

  assert.deepEqual(
    availableProjects(rows).map((r) => r.project.buildsuiteProjectId),
    ['BSA-APS-001', 'BSA-APS-002', 'BSA-053', 'BSA-052'],
  );
});

test('BSA-052 is back, and admitting active is what put it there', () => {
  // It vanished under the awarded-only rule on 2026-09-12 and `active` was
  // added the same day for exactly this reason. Pinned, because this one row is
  // the entire point of the second stage word.
  assert.equal(
    isAvailableProject(row({ code: 'BSA-052', sourceStatus: 'active', signed: true })),
    true,
  );
});

// ── The summary, and the row worth chasing ───────────────────────────────────

test('the two held-back reasons are counted apart, never added together', () => {
  // They mean opposite things to a contractor. "At another stage" is the
  // pipeline working; "not signed or won" is a live job nobody has closed. One
  // combined hidden-count is how the second stops being chased.
  const summary = summarizeAvailable([
    row({ sourceStatus: 'awarded', signed: true }),
    row({ sourceStatus: 'active', signed: false, proposalStatus: 'submitted' }),
    row({ sourceStatus: 'draft', noProposal: true }),
    row({ sourceStatus: 'completed', signed: true }),
  ]);

  assert.deepEqual(summary, { total: 4, available: 1, otherStage: 2, notAgreed: 1 });
});

test('the three counts always partition the whole list', () => {
  // Or the banner reports more hidden projects than exist.
  const summary = summarizeAvailable([
    row({ sourceStatus: 'active', signed: true }),
    row({ sourceStatus: 'active', signed: false }),
    row({ sourceStatus: 'awarded', noProposal: true }),
    row({ sourceStatus: 'new', signed: true }),
    row({ sourceStatus: undefined, noProposal: true }),
  ]);
  assert.equal(summary.available + summary.otherStage + summary.notAgreed, summary.total);
});

test('the banner names the chaseable count in its own words', () => {
  const banner = availableProjectsBanner({ total: 5, available: 3, otherStage: 1, notAgreed: 1 });
  assert.match(banner!, /Showing 3 projects on a signed or won proposal/);
  assert.match(banner!, /1 at another stage/);
  assert.match(banner!, /1 not signed or won/);
});

test('the banner disappears when nothing is held back', () => {
  // A banner that never goes away is a banner people stop reading.
  assert.equal(
    availableProjectsBanner({ total: 3, available: 3, otherStage: 0, notAgreed: 0 }),
    null,
  );
  assert.equal(
    availableProjectsBanner({ total: 0, available: 0, otherStage: 0, notAgreed: 0 }),
    null,
  );
});

test('an empty list says so rather than claiming to show nothing', () => {
  const banner = availableProjectsBanner({ total: 4, available: 0, otherStage: 4, notAgreed: 0 });
  assert.match(banner!, /No projects are live and signed yet/);
});

test('singular reads as singular', () => {
  const banner = availableProjectsBanner({ total: 2, available: 1, otherStage: 0, notAgreed: 1 });
  assert.match(banner!, /Showing 1 project on a signed or won proposal/);
  assert.match(banner!, /1 not signed or won/);
});
