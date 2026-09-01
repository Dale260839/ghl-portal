/**
 * The deals ↔ projects join, and the signed-only filter.
 *
 * The filter decides what a contractor sees on their main screen, so the tests
 * that matter here are the ones about what it **must not** hide. Getting this
 * wrong in the safe direction shows a few extra rows; getting it wrong in the
 * other direction empties a contractor's book of work and looks like data loss.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeProposal, type BuildSuiteProposalRow, type Proposal } from './buildsuite/proposals.ts';
import type { Project } from './data/types.ts';
import {
  applySignedOnly,
  indexProposalsByProject,
  joinProposalsToProjects,
  signedWorkBanner,
  summarizeSignedWork,
} from './signed-work.ts';

function project(id: string, name = 'A project'): Project {
  // Only the fields the join reads; the rest of Project is irrelevant here and
  // inventing values for it would make the test look like it tests more.
  return { buildsuiteProjectId: id, projectName: name } as Project;
}

function proposal(over: Partial<BuildSuiteProposalRow> = {}): Proposal {
  return normalizeProposal({
    id: 'prop-1',
    project_id: 'p1',
    contractor_id: 'contractor-1',
    status: 'submitted',
    price: '8000.0',
    subtotal: null,
    total: null,
    valid_until: null,
    timeline: '4 weeks',
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-02T10:00:00Z',
    submitted_at: '2026-03-02T10:00:00Z',
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

const SIGNED = { status: 'accepted', signature_status: 'SIGNED', signature_signed_at: '2026-02-11T02:51:28Z' };

// ── The three states ─────────────────────────────────────────────────────────

test('a project is signed, unsigned, or unknown — never just two of those', () => {
  const rows = joinProposalsToProjects(
    [project('p-signed'), project('p-unsigned'), project('p-nodeal')],
    [
      proposal({ id: 'd1', project_id: 'p-signed', ...SIGNED }),
      proposal({ id: 'd2', project_id: 'p-unsigned' }),
    ],
  );

  assert.deepEqual(
    rows.map((r) => r.status),
    ['signed', 'unsigned', 'unknown'],
  );
});

test('a SIGNED status counts even with no signature timestamp', () => {
  // The status and the timestamp are written by different steps of Adobe's
  // callback, so either alone is evidence a contract exists.
  const rows = joinProposalsToProjects(
    [project('p1')],
    [proposal({ project_id: 'p1', status: 'accepted', signature_status: 'SIGNED' })],
  );

  assert.equal(rows[0].status, 'signed');
});

test('accepted is NOT signed', () => {
  // The client said yes; nobody has signed anything. This is exactly the
  // distinction the deals-based version got wrong: it read `sent_to_crm_at`
  // and called two projects signed, one of which had no proposal at all.
  const rows = joinProposalsToProjects(
    [project('p1')],
    [proposal({ project_id: 'p1', status: 'accepted' })],
  );

  assert.equal(rows[0].status, 'unsigned');
});

test('a signature merely sent is not signed', () => {
  const rows = joinProposalsToProjects(
    [project('p1')],
    [proposal({ project_id: 'p1', signature_status: 'SENT' })],
  );

  assert.equal(rows[0].status, 'unsigned');
});

// ── What the filter must not hide ────────────────────────────────────────────

test('a project with no proposal survives the filter', () => {
  // THE important one. Only 26% of deals carry a project id, so the reverse join
  // is sparse. Treating "no deal" as "not signed" hides most of the book of work
  // and reads to a contractor as data loss.
  const rows = joinProposalsToProjects([project('p-nodeal')], []);

  assert.deepEqual(applySignedOnly(rows, true).map((r) => r.project.buildsuiteProjectId), [
    'p-nodeal',
  ]);
});

test('the filter hides exactly the projects proven unsigned, and nothing else', () => {
  const rows = joinProposalsToProjects(
    [project('p-signed'), project('p-unsigned'), project('p-nodeal')],
    [
      proposal({ id: 'd1', project_id: 'p-signed', ...SIGNED }),
      proposal({ id: 'd2', project_id: 'p-unsigned' }),
    ],
  );

  assert.deepEqual(
    applySignedOnly(rows, true).map((r) => r.project.buildsuiteProjectId),
    ['p-signed', 'p-nodeal'],
  );
});

test('with the filter off nothing is removed at all', () => {
  const rows = joinProposalsToProjects(
    [project('p1'), project('p2')],
    [proposal({ project_id: 'p1' })],
  );

  assert.equal(applySignedOnly(rows, false).length, 2);
});

// ── The join itself ──────────────────────────────────────────────────────────

test('a signed proposal wins when several point at the same project', () => {
  // Nothing in BuildSuite forbids it, and whichever row came back first would
  // otherwise decide whether a contractor sees their own signed job.
  const byProject = indexProposalsByProject([
    proposal({ id: 'unsigned-first', project_id: 'p1' }),
    proposal({ id: 'signed-second', project_id: 'p1', ...SIGNED }),
  ]);

  assert.equal(byProject.get('p1')?.id, 'signed-second');

  // …and in the other arrival order, which is the case that actually breaks.
  const reversed = indexProposalsByProject([
    proposal({ id: 'signed-first', project_id: 'p1', ...SIGNED }),
    proposal({ id: 'unsigned-second', project_id: 'p1' }),
  ]);

  assert.equal(reversed.get('p1')?.id, 'signed-first');
});

test('a proposal for an unknown project does not attach to a known one', () => {
  const byProject = indexProposalsByProject([proposal({ project_id: 'somewhere-else' })]);

  assert.equal(byProject.has('p1'), false);
  assert.equal(byProject.has('somewhere-else'), true);
});

test('the join never invents or drops a row', () => {
  const projects = [project('p1'), project('p2'), project('p3')];
  const rows = joinProposalsToProjects(projects, [proposal({ project_id: 'p1' })]);

  assert.equal(rows.length, projects.length);
  assert.deepEqual(
    rows.map((r) => r.project.buildsuiteProjectId),
    ['p1', 'p2', 'p3'],
  );
});

// ── The live shape ───────────────────────────────────────────────────────────

test('the real Alliance shape: 9 projects, 8 quoted, none signed', () => {
  // Measured 2026-08-28. Two projects are both named "Jenkins" and only one of
  // them has a deal — which is exactly why the join keys on the id.
  const ids = ['80ef9efa', 'ecf9ff21', 'f380486a', '9fe369a3', 'ca538fc1', '961371fd', '975fe394', '1c0a1fd5'];
  const rows = joinProposalsToProjects(
    [...ids.map((id) => project(id)), project('f80b7d1e', 'Jenkins')],
    ids.map((id, i) => proposal({ id: `d${i}`, project_id: id })),
  );

  const summary = summarizeSignedWork(rows);
  assert.equal(summary.total, 9);
  assert.equal(summary.signed, 0);
  assert.equal(summary.unsigned, 8);
  assert.equal(summary.unknown, 1, 'the second Jenkins has no proposal');
  assert.equal(summary.wouldHide, 8);

  // Switching the filter on today leaves one row — which is why it ships off.
  assert.equal(applySignedOnly(rows, true).length, 1);
});

test('an empty tenant summarizes to zeros and is not called empty-by-filter', () => {
  const summary = summarizeSignedWork([]);

  assert.equal(summary.total, 0);
  assert.equal(
    summary.filterWouldEmpty,
    false,
    'a tenant with no projects is not a tenant the filter emptied',
  );
});

// ── The banner ───────────────────────────────────────────────────────────────

test('the banner names the count and says why the filter is off', () => {
  const rows = joinProposalsToProjects(
    [project('p1'), project('p2')],
    [proposal({ project_id: 'p1' })],
  );

  const banner = signedWorkBanner(summarizeSignedWork(rows), false);
  assert.match(banner ?? '', /Showing all work/);
  assert.match(banner ?? '', /None of these 2 projects has a signed proposal/);
  assert.match(banner ?? '', /1 has no proposal to check/);
  assert.match(banner ?? '', /turns on when signatures start landing/);
});

test('the banner changes the day something is signed', () => {
  const rows = joinProposalsToProjects(
    [project('p1'), project('p2')],
    [proposal({ id: 'd1', project_id: 'p1', ...SIGNED }), proposal({ id: 'd2', project_id: 'p2' })],
  );

  const banner = signedWorkBanner(summarizeSignedWork(rows), false);
  assert.match(banner ?? '', /1 of 2 projects are on a signed proposal/);
  assert.doesNotMatch(banner ?? '', /None of these/);
});

test('the banner goes away when there is nothing to warn about', () => {
  // A banner that never disappears is a banner people stop reading.
  const allSigned = joinProposalsToProjects(
    [project('p1')],
    [proposal({ project_id: 'p1', ...SIGNED })],
  );

  assert.equal(signedWorkBanner(summarizeSignedWork(allSigned), true), null);
  assert.equal(signedWorkBanner(summarizeSignedWork([]), false), null);
});

test('with the filter on the banner says what it is hiding', () => {
  const rows = joinProposalsToProjects(
    [project('p1'), project('p2')],
    [proposal({ id: 'd1', project_id: 'p1', ...SIGNED }), proposal({ id: 'd2', project_id: 'p2' })],
  );

  assert.match(
    signedWorkBanner(summarizeSignedWork(rows), true) ?? '',
    /Showing signed work only\. 1 unsigned project is hidden\./,
  );
});
