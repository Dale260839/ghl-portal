import assert from 'node:assert/strict';
import test from 'node:test';

import {
  availableProjects,
  availableProjectsBanner,
  isAvailableProject,
  isAwarded,
  isSignedOrWon,
  summarizeAvailable,
} from './available-projects.ts';
import type { ProjectSigning } from './signed-work.ts';
import type { Project } from './data/types.ts';
import type { Proposal } from './buildsuite/proposals.ts';

/**
 * Which projects reach the Projects screen.
 *
 * The rule is two conditions — stage `awarded`, and a proposal that is signed
 * or won — and the cases that matter are the ones where only ONE holds. Both
 * of those exist in the live data, which is why the rule is both.
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

// ── The two halves ───────────────────────────────────────────────────────────

test('stage awarded is read from sourceStatus, not the §7 pipeline', () => {
  // `projectStage` is the GHL pipeline — `New Project` … `Warranty` — and has
  // no `awarded` in it at all. BuildSuite's own word lives in `sourceStatus`.
  assert.equal(isAwarded({ sourceStatus: 'awarded' }), true);
  assert.equal(isAwarded({ sourceStatus: 'active' }), false);
  assert.equal(isAwarded({ sourceStatus: 'draft' }), false);
  assert.equal(isAwarded({ sourceStatus: undefined }), false);
});

test('the stage word survives being capitalised or padded', () => {
  // A free-text column on somebody else's database. An exact-match check is how
  // this screen empties itself the day the value arrives with a capital A.
  for (const value of ['Awarded', 'AWARDED', '  awarded  ', 'aWaRdEd']) {
    assert.equal(isAwarded({ sourceStatus: value }), true, `rejected ${JSON.stringify(value)}`);
  }
});

test('signed and won both count, and neither is required to be the other', () => {
  // Measured 2026-09-12: `accepted` and `SIGNED` are the same 8 proposals, so
  // these never disagree today. The day they do is a won job whose paperwork
  // has not caught up, and that is the worst moment to drop it off the list.
  assert.equal(isSignedOrWon(row({ signed: true, proposalStatus: 'submitted' })), true);
  assert.equal(isSignedOrWon(row({ signed: false, proposalStatus: 'accepted' })), true);
  assert.equal(isSignedOrWon(row({ signed: false, proposalStatus: 'won' })), true);
  assert.equal(isSignedOrWon(row({ signed: true, proposalStatus: 'accepted' })), true);
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

test('awarded AND signed shows; either one alone does not', () => {
  assert.equal(isAvailableProject(row({ sourceStatus: 'awarded', signed: true })), true);

  // Stage alone: nothing has checked that anyone agreed a price.
  assert.equal(isAvailableProject(row({ sourceStatus: 'awarded', signed: false })), false);

  // Signed alone: this is BSA-052 in the live data — Sing's [HUB TEST] record,
  // a real signed proposal on a project at stage `active`. It is EXPECTED to
  // disappear from Projects under this rule.
  assert.equal(isAvailableProject(row({ sourceStatus: 'active', signed: true })), false);
});

test('the live shape, reproduced', () => {
  // 2026-09-12, exactly what the database holds: three awarded-and-signed, one
  // signed-but-active, one draft with no proposal.
  const rows = [
    row({ code: 'BSA-APS-001', sourceStatus: 'awarded', signed: true, proposalStatus: 'accepted' }),
    row({ code: 'BSA-APS-002', sourceStatus: 'awarded', signed: true, proposalStatus: 'accepted' }),
    row({ code: 'BSA-053', sourceStatus: 'awarded', signed: true, proposalStatus: 'accepted' }),
    row({ code: 'BSA-052', sourceStatus: 'active', signed: true, proposalStatus: 'accepted' }),
    row({ code: 'BSA-999', sourceStatus: 'draft', noProposal: true }),
  ];

  assert.deepEqual(
    availableProjects(rows).map((r) => r.project.buildsuiteProjectId),
    ['BSA-APS-001', 'BSA-APS-002', 'BSA-053'],
  );
});

// ── The summary, and the row worth chasing ───────────────────────────────────

test('the two held-back reasons are counted apart, never added together', () => {
  // They mean opposite things to a contractor. "Not awarded yet" is the
  // pipeline working; "awarded but unsigned" is a job to chase. One combined
  // hidden-count is how the second stops being chased.
  const summary = summarizeAvailable([
    row({ sourceStatus: 'awarded', signed: true }),
    row({ sourceStatus: 'awarded', signed: false, proposalStatus: 'submitted' }),
    row({ sourceStatus: 'draft', noProposal: true }),
    row({ sourceStatus: 'active', signed: true }),
  ]);

  assert.deepEqual(summary, { total: 4, available: 1, notAwarded: 2, awardedNotAgreed: 1 });
});

test('an unawarded project is counted once, whatever its proposal says', () => {
  // `notAwarded` and `awardedNotAgreed` must partition the held-back rows, or
  // the banner reports more hidden projects than exist.
  const summary = summarizeAvailable([
    row({ sourceStatus: 'active', signed: true }),
    row({ sourceStatus: 'active', signed: false }),
  ]);
  assert.equal(summary.notAwarded + summary.awardedNotAgreed + summary.available, summary.total);
  assert.equal(summary.awardedNotAgreed, 0);
});

test('the banner names the chaseable count in its own words', () => {
  const banner = availableProjectsBanner({
    total: 5,
    available: 3,
    notAwarded: 1,
    awardedNotAgreed: 1,
  });
  assert.match(banner!, /Showing 3 awarded projects/);
  assert.match(banner!, /1 not awarded yet/);
  assert.match(banner!, /1 awarded but it is not signed or won/);
});

test('the banner disappears when nothing is held back', () => {
  // A banner that never goes away is a banner people stop reading.
  assert.equal(
    availableProjectsBanner({ total: 3, available: 3, notAwarded: 0, awardedNotAgreed: 0 }),
    null,
  );
  assert.equal(
    availableProjectsBanner({ total: 0, available: 0, notAwarded: 0, awardedNotAgreed: 0 }),
    null,
  );
});

test('an empty list says so rather than claiming to show nothing', () => {
  const banner = availableProjectsBanner({
    total: 4,
    available: 0,
    notAwarded: 4,
    awardedNotAgreed: 0,
  });
  assert.match(banner!, /No projects are awarded and signed yet/);
});

test('singular reads as singular', () => {
  const banner = availableProjectsBanner({
    total: 2,
    available: 1,
    notAwarded: 0,
    awardedNotAgreed: 1,
  });
  assert.match(banner!, /Showing 1 awarded project on a signed or won proposal/);
  assert.match(banner!, /1 awarded but it is not signed or won/);
});
