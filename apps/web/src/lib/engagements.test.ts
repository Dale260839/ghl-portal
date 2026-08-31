/**
 * Engagements — the book of work.
 *
 * These pin the two decisions that make the contractor dashboard usable:
 * which proposal represents a project, and what happens when the project row
 * behind an engagement cannot be read.
 *
 * The second one is not defensive coding. The only signed job in the database is
 * on a project BuildSuite's RLS hides from our key, so "drop engagements with no
 * readable project" would hide the single piece of real work in the system.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NO_CONTRACTOR,
  isLiveEngagement,
  normalizeProposal,
  pickCurrentProposal,
  type BuildSuiteProposalRow,
  type Proposal,
} from './buildsuite/proposals.ts';
import type { Project } from './data/types.ts';
import { buildEngagements, leadProjects, summarizeEngagements } from './engagements.ts';

function proposal(over: Partial<BuildSuiteProposalRow> = {}): Proposal {
  return normalizeProposal({
    id: 'prop-1',
    project_id: 'proj-1',
    contractor_id: '5dd312bd-0b95-45af-be7b-c19a14eff103',
    status: 'submitted',
    price: '8000.0',
    subtotal: null,
    total: null,
    valid_until: null,
    timeline: '4 weeks',
    created_at: '2026-02-01T10:00:00Z',
    updated_at: '2026-02-02T10:00:00Z',
    submitted_at: '2026-02-02T10:00:00Z',
    accepted_at: null,
    rejected_at: null,
    signature_status: null,
    signature_sent_at: null,
    signature_signed_at: null,
    source_deal_id: null,
    deleted_at: null,
    ...over,
  });
}

function project(id: string, name = 'A project'): Project {
  return {
    buildsuiteProjectId: id,
    projectName: name,
    clientName: 'Chris Carr',
    projectAddress: '1 Example St',
  } as Project;
}

const SIGNED = { status: 'accepted', signature_status: 'SIGNED', signature_signed_at: '2026-02-11T02:51:28Z' };

// ── What counts as work ──────────────────────────────────────────────────────

test('a draft is not an engagement — nobody outside BuildSuite has seen it', () => {
  assert.equal(isLiveEngagement(proposal({ status: 'draft', submitted_at: null })), false);
});

test('submitted, accepted and signed are all live work', () => {
  assert.equal(isLiveEngagement(proposal({ status: 'submitted' })), true);
  assert.equal(isLiveEngagement(proposal({ status: 'accepted' })), true);
  assert.equal(isLiveEngagement(proposal(SIGNED)), true);
});

test('rejected and soft-deleted proposals drop out', () => {
  assert.equal(isLiveEngagement(proposal({ status: 'rejected' })), false);
  assert.equal(isLiveEngagement(proposal({ deleted_at: '2026-03-01T00:00:00Z' })), false);
});

test('the all-zero contractor id is not a contractor', () => {
  // BuildSuite writes it as a placeholder. A plain null-check reads it as a
  // genuine match, which would show an unassigned job as assigned.
  assert.equal(proposal({ contractor_id: NO_CONTRACTOR }).contractorId, null);
  assert.equal(proposal({ contractor_id: null }).contractorId, null);
});

test('a price is only an amount when BuildSuite holds a real number', () => {
  // `price` is free text on all 46 rows; `total` is set on 8. Parsing
  // "$25k-$50k" into a number is how a wrong figure reaches a contract.
  assert.equal(proposal({ price: '$25k-$50k', total: null }).amount, null);
  assert.equal(proposal({ price: '$25k-$50k', total: null }).priceText, '$25k-$50k');
  assert.equal(proposal({ total: 39600 }).amount, 39600);
  assert.equal(proposal({ total: null, subtotal: 4070 }).amount, 4070);
});

// ── Which proposal represents the project ────────────────────────────────────

test('signed beats accepted beats submitted, in any arrival order', () => {
  // Not hypothetical: the one signed project carries seven proposals.
  const submitted = proposal({ id: 'a', status: 'submitted' });
  const accepted = proposal({ id: 'b', status: 'accepted' });
  const signed = proposal({ id: 'c', ...SIGNED });

  assert.equal(pickCurrentProposal([submitted, accepted, signed])?.id, 'c');
  assert.equal(pickCurrentProposal([signed, accepted, submitted])?.id, 'c');
  assert.equal(pickCurrentProposal([submitted, accepted])?.id, 'b');
});

test('at equal rank the most recently updated wins', () => {
  const older = proposal({ id: 'old', updated_at: '2026-02-01T00:00:00Z' });
  const newer = proposal({ id: 'new', updated_at: '2026-03-01T00:00:00Z' });

  assert.equal(pickCurrentProposal([older, newer])?.id, 'new');
  assert.equal(pickCurrentProposal([newer, older])?.id, 'new');
});

test('a project whose every proposal is rejected has no current one', () => {
  assert.equal(pickCurrentProposal([proposal({ status: 'rejected' })]), null);
  assert.equal(pickCurrentProposal([]), null);
});

// ── The book of work ─────────────────────────────────────────────────────────

test('engagements group by project and lead with signed work', () => {
  const engagements = buildEngagements({
    proposals: [
      proposal({ id: 'p1', project_id: 'proj-a', status: 'submitted' }),
      proposal({ id: 'p2', project_id: 'proj-b', ...SIGNED }),
      proposal({ id: 'p3', project_id: 'proj-c', status: 'accepted' }),
    ],
    projects: [project('proj-a'), project('proj-b'), project('proj-c')],
  });

  assert.deepEqual(
    engagements.map((e) => e.stage),
    ['signed', 'accepted', 'proposed'],
  );
});

test('several proposals on one project make ONE engagement', () => {
  const engagements = buildEngagements({
    proposals: [
      proposal({ id: 'p1', project_id: 'proj-a', status: 'submitted' }),
      proposal({ id: 'p2', project_id: 'proj-a', ...SIGNED }),
    ],
    projects: [project('proj-a')],
  });

  assert.equal(engagements.length, 1);
  assert.equal(engagements[0].proposalCount, 2);
  assert.equal(engagements[0].stage, 'signed', 'the signed one represents it');
});

test('an engagement survives its project being unreadable', () => {
  // THE important one. BuildSuite's RLS hides the only signed project from our
  // key; dropping it would remove the single piece of real work in the system.
  const engagements = buildEngagements({
    proposals: [proposal({ project_id: 'hidden-proj', ...SIGNED })],
    projects: [],
  });

  assert.equal(engagements.length, 1);
  assert.equal(engagements[0].project, null);
  assert.equal(engagements[0].stage, 'signed');
  assert.match(engagements[0].title, /not readable/i, 'it must say so, not show a bare UUID');
});

test('a draft-only project is a lead, not an engagement', () => {
  const engagements = buildEngagements({
    proposals: [proposal({ project_id: 'proj-a', status: 'draft', submitted_at: null })],
    projects: [project('proj-a')],
  });

  assert.deepEqual(engagements, []);
});

// ── The summary ──────────────────────────────────────────────────────────────

test('the summary counts unreadable projects rather than hiding them', () => {
  const engagements = buildEngagements({
    proposals: [
      proposal({ id: 'p1', project_id: 'visible', total: 8000 }),
      proposal({ id: 'p2', project_id: 'hidden', ...SIGNED }),
    ],
    projects: [project('visible')],
  });

  const summary = summarizeEngagements(engagements);
  assert.equal(summary.total, 2);
  assert.equal(summary.signed, 1);
  assert.equal(summary.unreadableProjects, 1);
});

test('known value sums only real numbers, and says how many lack one', () => {
  // A total that quietly treats "$25k-$50k" as zero is a number nobody can act
  // on. It is reported alongside the count it could not include.
  const engagements = buildEngagements({
    proposals: [
      proposal({ id: 'p1', project_id: 'a', total: 39600 }),
      proposal({ id: 'p2', project_id: 'b', total: 4070 }),
      proposal({ id: 'p3', project_id: 'c', price: '$25k-$50k', total: null }),
    ],
    projects: [project('a'), project('b'), project('c')],
  });

  const summary = summarizeEngagements(engagements);
  assert.equal(summary.knownValue, 43_670);
  assert.equal(summary.withoutAmount, 1);
});

test('an empty tenant summarizes to zeros rather than throwing', () => {
  const summary = summarizeEngagements(buildEngagements({ proposals: [], projects: [] }));

  assert.equal(summary.total, 0);
  assert.equal(summary.knownValue, 0);
});

// ── Leads ────────────────────────────────────────────────────────────────────

test('projects with no live proposal are returned as leads, not discarded', () => {
  // They stop being the front page; they do not stop existing. A contractor who
  // cannot find a project they know about concludes the system lost it.
  const projects = [project('engaged'), project('lead-1'), project('lead-2')];
  const engagements = buildEngagements({
    proposals: [proposal({ project_id: 'engaged' })],
    projects,
  });

  assert.deepEqual(
    leadProjects(projects, engagements).map((p) => p.buildsuiteProjectId),
    ['lead-1', 'lead-2'],
  );
});

// ── The live shape ───────────────────────────────────────────────────────────

test('the real AFC book of work reproduces: one project, signed', () => {
  // Measured 2026-08-31. Contractor 5dd312bd holds 5 live proposals across one
  // project, 4 of them signed, and that project is RLS-hidden from our key.
  const engagements = buildEngagements({
    proposals: [
      ...Array.from({ length: 4 }, (_, i) =>
        proposal({ id: `s${i}`, project_id: '87a42c43', ...SIGNED }),
      ),
      proposal({ id: 'sub', project_id: '87a42c43', status: 'submitted' }),
    ],
    projects: [],
  });

  assert.equal(engagements.length, 1, 'five proposals, one job');
  assert.equal(engagements[0].proposalCount, 5);
  assert.equal(engagements[0].stage, 'signed');
  assert.equal(engagements[0].project, null);
  assert.equal(summarizeEngagements(engagements).signed, 1);
});
