import assert from 'node:assert/strict';
import test from 'node:test';

import {
  availableProjects,
  availableProjectsBanner,
  isAvailableProject,
  isAvailableStage,
  isDraftStage,
  isSignedOrWon,
  parseProjectView,
  PROJECT_VIEWS,
  projectsForView,
  projectViewCounts,
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
 * exist in the live data, which is why the rule is both.
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

test('only awarded passes; the other five stages do not', () => {
  // The live vocabulary is matched · active · draft · new · awarded · completed.
  assert.equal(isAvailableStage({ sourceStatus: 'awarded' }), true);

  for (const stage of ['active', 'draft', 'matched', 'new', 'completed']) {
    assert.equal(isAvailableStage({ sourceStatus: stage }), false, `${stage} passed`);
  }
  assert.equal(isAvailableStage({ sourceStatus: undefined }), false);
});

test('active does NOT pass, and the reason is worth remembering', () => {
  // `active` was admitted for about an hour on 2026-09-12 to rescue BSA-053,
  // which was awarded, signed, and missing from the screen. Wrong diagnosis:
  // that project has a null `auth_profile_id` and reaches no listing at ANY
  // stage. Widening the stage also put 42 unsigned active projects through the
  // money check in order to admit one row.
  assert.equal(isAvailableStage({ sourceStatus: 'active' }), false);
  assert.equal(isAvailableStage({ sourceStatus: 'completed' }), false);
});

test('the stage word survives being capitalised or padded', () => {
  // A free-text column on somebody else's database. An exact-match check is how
  // this screen empties itself the day the value arrives with a capital A.
  for (const value of ['Awarded', 'AWARDED', '  awarded  ', 'aWaRdEd']) {
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

test('awarded AND agreement shows; either one alone does not', () => {
  assert.equal(isAvailableProject(row({ sourceStatus: 'awarded', signed: true })), true);

  // Stage alone: nothing has checked that anyone agreed a price.
  assert.equal(isAvailableProject(row({ sourceStatus: 'awarded', signed: false })), false);

  // Agreement alone: a signed proposal at any other stage.
  for (const stage of ['active', 'draft', 'completed', 'new', 'matched']) {
    assert.equal(
      isAvailableProject(row({ sourceStatus: stage, signed: true })),
      false,
      `${stage} + signed passed`,
    );
  }
});

test('the live shape, reproduced', () => {
  // 2026-09-12, what the database actually holds across every tenant: three
  // awarded-and-signed (BSA-053 among them, once adoption makes it listable),
  // BSA-052 signed but active, and two that fail on stage or on money.
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
    ['BSA-APS-001', 'BSA-APS-002', 'BSA-053'],
  );
});

test('BSA-053 shows — the third project that was missing from the screen', () => {
  // It was awarded and signed all along. What hid it was a null
  // `auth_profile_id` on the project row, which kept it out of every listing.
  // `listProjectRows` adopts it now, so by the time it reaches this rule there
  // is nothing special about it — which is the point.
  assert.equal(
    isAvailableProject(row({ code: 'BSA-053', sourceStatus: 'awarded', signed: true })),
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
    row({ sourceStatus: 'awarded', signed: false, proposalStatus: 'submitted' }),
    row({ sourceStatus: 'draft', noProposal: true }),
    row({ sourceStatus: 'completed', signed: true }),
  ]);

  assert.deepEqual(summary, { total: 4, available: 1, otherStage: 2, notAgreed: 1 });
});

test('the three counts always partition the whole list', () => {
  // Or the banner reports more hidden projects than exist.
  const summary = summarizeAvailable([
    row({ sourceStatus: 'awarded', signed: true }),
    row({ sourceStatus: 'awarded', signed: false }),
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
  assert.match(banner!, /No projects are awarded and signed yet/);
});

test('singular reads as singular', () => {
  const banner = availableProjectsBanner({ total: 2, available: 1, otherStage: 0, notAgreed: 1 });
  assert.match(banner!, /Showing 1 project on a signed or won proposal/);
  assert.match(banner!, /1 not signed or won/);
});

// ── The pills: Awarded · Draft · All ─────────────────────────────────────────

test('the view comes from the URL and falls back to Awarded', () => {
  assert.equal(parseProjectView(undefined), 'awarded');
  assert.equal(parseProjectView('draft'), 'draft');
  assert.equal(parseProjectView('all'), 'all');
  assert.equal(parseProjectView('awarded'), 'awarded');
  // An old link, a typo, a pasted value — land on the default, never on an
  // empty table that looks like data loss.
  for (const junk of ['', 'drafts', 'signed', 'active', '<script>', 'ALL ']) {
    const parsed = parseProjectView(junk);
    assert.ok(PROJECT_VIEWS.includes(parsed), `${junk} produced ${parsed}`);
  }
  assert.equal(parseProjectView('ALL '), 'all');
  assert.equal(parseProjectView('Draft'), 'draft');
  // `?view=draft&view=all` arrives as an array. The first one wins.
  assert.equal(parseProjectView(['draft', 'all']), 'draft');
});

test('Awarded is exactly the rule the screen already had', () => {
  // "This table is good now" was said about this view. The pills add views;
  // they must not change this one.
  const rows = [
    row({ code: 'A', sourceStatus: 'awarded', signed: true }),
    row({ code: 'B', sourceStatus: 'awarded', signed: false }),
    row({ code: 'C', sourceStatus: 'draft', noProposal: true }),
  ];
  assert.deepEqual(
    projectsForView(rows, 'awarded').map((r) => r.project.buildsuiteProjectId),
    availableProjects(rows).map((r) => r.project.buildsuiteProjectId),
  );
});

test('Draft is the draft stage, with no signature test', () => {
  // A draft has nobody's agreement on it by definition. Requiring one would
  // make this pill permanently empty.
  const rows = [
    row({ code: 'BSA-APS-005', sourceStatus: 'draft', noProposal: true }),
    row({ code: 'D2', sourceStatus: ' Draft ', signed: false }),
    row({ code: 'AW', sourceStatus: 'awarded', signed: true }),
    row({ code: 'AC', sourceStatus: 'active', noProposal: true }),
  ];
  assert.deepEqual(
    projectsForView(rows, 'draft').map((r) => r.project.buildsuiteProjectId),
    ['BSA-APS-005', 'D2'],
  );
  assert.equal(isDraftStage({ sourceStatus: 'draft' }), true);
  assert.equal(isDraftStage({ sourceStatus: 'awarded' }), false);
  assert.equal(isDraftStage({ sourceStatus: undefined }), false);
});

test('All is everything, including what Awarded holds back', () => {
  // The awarded-but-unsigned job is the one worth chasing, and All is the one
  // place it is visible. Nothing is filtered here — not stage, not signature.
  const rows = [
    row({ code: 'A', sourceStatus: 'awarded', signed: true }),
    row({ code: 'B', sourceStatus: 'awarded', signed: false }),
    row({ code: 'C', sourceStatus: 'draft', noProposal: true }),
    row({ code: 'D', sourceStatus: 'completed', signed: true }),
    row({ code: 'E', sourceStatus: undefined, noProposal: true }),
  ];
  assert.deepEqual(
    projectsForView(rows, 'all').map((r) => r.project.buildsuiteProjectId),
    ['A', 'B', 'C', 'D', 'E'],
  );
});

test('each pill count is the length of its own view', () => {
  // The number on a pill and the rows behind it must never disagree — that is
  // the one thing that makes a count worth showing.
  const rows = [
    row({ sourceStatus: 'awarded', signed: true }),
    row({ sourceStatus: 'awarded', signed: true }),
    row({ sourceStatus: 'awarded', signed: true }),
    row({ sourceStatus: 'draft', noProposal: true }),
  ];
  const counts = projectViewCounts(rows);
  // Alliance Pro Services, 2026-09-12: Awarded 3 · Draft 1 · All 4.
  assert.deepEqual(counts, { awarded: 3, draft: 1, all: 4 });
  for (const view of PROJECT_VIEWS) {
    assert.equal(counts[view], projectsForView(rows, view).length, `${view} count disagrees`);
  }
});

test('All is never smaller than Awarded or Draft', () => {
  const rows = [
    row({ sourceStatus: 'awarded', signed: true }),
    row({ sourceStatus: 'draft', noProposal: true }),
    row({ sourceStatus: 'new', noProposal: true }),
  ];
  const counts = projectViewCounts(rows);
  assert.ok(counts.all >= counts.awarded && counts.all >= counts.draft);
});
