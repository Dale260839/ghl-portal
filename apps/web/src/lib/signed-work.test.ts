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

import { normalizeDeal, type BuildSuiteDealRow, type Deal } from './buildsuite/deals.ts';
import type { Project } from './data/types.ts';
import {
  applySignedOnly,
  indexDealsByProject,
  joinDealsToProjects,
  signedWorkBanner,
  summarizeSignedWork,
} from './signed-work.ts';

function project(id: string, name = 'A project'): Project {
  // Only the fields the join reads; the rest of Project is irrelevant here and
  // inventing values for it would make the test look like it tests more.
  return { buildsuiteProjectId: id, projectName: name } as Project;
}

function deal(over: Partial<BuildSuiteDealRow> = {}): Deal {
  return normalizeDeal({
    id: 'deal-1',
    status: 'draft_ready',
    source: 'ghl_project_quote_survey',
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-02T10:00:00Z',
    auth_profile_id: 'profile-a',
    source_project_id: null,
    matched_contractor_id: null,
    sent_to_crm_at: null,
    signature_status: null,
    signature_signed_at: null,
    client_name: 'Chris Carr',
    project_type: 'kitchen',
    budget_range: '10k_25k',
    ghl_contact_id: null,
    ghl_opportunity_id: null,
    coverage_score: null,
    ...over,
  });
}

const SIGNED = { signature_signed_at: '2026-08-20T09:00:00Z' };

// ── The three states ─────────────────────────────────────────────────────────

test('a project is signed, unsigned, or unknown — never just two of those', () => {
  const rows = joinDealsToProjects(
    [project('p-signed'), project('p-unsigned'), project('p-nodeal')],
    [
      deal({ id: 'd1', source_project_id: 'p-signed', ...SIGNED }),
      deal({ id: 'd2', source_project_id: 'p-unsigned' }),
    ],
  );

  assert.deepEqual(
    rows.map((r) => r.status),
    ['signed', 'unsigned', 'unknown'],
  );
});

test('reaching the CRM counts as signed even with no signature timestamp', () => {
  const rows = joinDealsToProjects(
    [project('p1')],
    [deal({ source_project_id: 'p1', sent_to_crm_at: '2026-08-20T09:05:00Z' })],
  );

  assert.equal(rows[0].status, 'signed');
});

test('a signature merely sent is not signed', () => {
  const rows = joinDealsToProjects(
    [project('p1')],
    [deal({ source_project_id: 'p1', signature_status: 'SENT' })],
  );

  assert.equal(rows[0].status, 'unsigned');
});

// ── What the filter must not hide ────────────────────────────────────────────

test('a project with no deal survives the filter', () => {
  // THE important one. Only 26% of deals carry a project id, so the reverse join
  // is sparse. Treating "no deal" as "not signed" hides most of the book of work
  // and reads to a contractor as data loss.
  const rows = joinDealsToProjects([project('p-nodeal')], []);

  assert.deepEqual(applySignedOnly(rows, true).map((r) => r.project.buildsuiteProjectId), [
    'p-nodeal',
  ]);
});

test('the filter hides exactly the projects proven unsigned, and nothing else', () => {
  const rows = joinDealsToProjects(
    [project('p-signed'), project('p-unsigned'), project('p-nodeal')],
    [
      deal({ id: 'd1', source_project_id: 'p-signed', ...SIGNED }),
      deal({ id: 'd2', source_project_id: 'p-unsigned' }),
    ],
  );

  assert.deepEqual(
    applySignedOnly(rows, true).map((r) => r.project.buildsuiteProjectId),
    ['p-signed', 'p-nodeal'],
  );
});

test('with the filter off nothing is removed at all', () => {
  const rows = joinDealsToProjects(
    [project('p1'), project('p2')],
    [deal({ source_project_id: 'p1' })],
  );

  assert.equal(applySignedOnly(rows, false).length, 2);
});

// ── The join itself ──────────────────────────────────────────────────────────

test('a signed deal wins when two deals point at the same project', () => {
  // Nothing in BuildSuite forbids it, and whichever row came back first would
  // otherwise decide whether a contractor sees their own signed job.
  const byProject = indexDealsByProject([
    deal({ id: 'unsigned-first', source_project_id: 'p1' }),
    deal({ id: 'signed-second', source_project_id: 'p1', ...SIGNED }),
  ]);

  assert.equal(byProject.get('p1')?.id, 'signed-second');

  // …and in the other arrival order, which is the case that actually breaks.
  const reversed = indexDealsByProject([
    deal({ id: 'signed-first', source_project_id: 'p1', ...SIGNED }),
    deal({ id: 'unsigned-second', source_project_id: 'p1' }),
  ]);

  assert.equal(reversed.get('p1')?.id, 'signed-first');
});

test('a deal with no project id joins to nothing rather than to everything', () => {
  const byProject = indexDealsByProject([deal({ source_project_id: null })]);

  assert.equal(byProject.size, 0);
});

test('the join never invents or drops a row', () => {
  const projects = [project('p1'), project('p2'), project('p3')];
  const rows = joinDealsToProjects(projects, [deal({ source_project_id: 'p1' })]);

  assert.equal(rows.length, projects.length);
  assert.deepEqual(
    rows.map((r) => r.project.buildsuiteProjectId),
    ['p1', 'p2', 'p3'],
  );
});

// ── The live shape ───────────────────────────────────────────────────────────

test('the real Alliance shape: 9 projects, 8 with a deal, none signed', () => {
  // Measured 2026-08-28. Two projects are both named "Jenkins" and only one of
  // them has a deal — which is exactly why the join keys on the id.
  const ids = ['80ef9efa', 'ecf9ff21', 'f380486a', '9fe369a3', 'ca538fc1', '961371fd', '975fe394', '1c0a1fd5'];
  const rows = joinDealsToProjects(
    [...ids.map((id) => project(id)), project('f80b7d1e', 'Jenkins')],
    ids.map((id, i) => deal({ id: `d${i}`, source_project_id: id })),
  );

  const summary = summarizeSignedWork(rows);
  assert.equal(summary.total, 9);
  assert.equal(summary.signed, 0);
  assert.equal(summary.unsigned, 8);
  assert.equal(summary.unknown, 1, 'the second Jenkins has no deal');
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
  const rows = joinDealsToProjects(
    [project('p1'), project('p2')],
    [deal({ source_project_id: 'p1' })],
  );

  const banner = signedWorkBanner(summarizeSignedWork(rows), false);
  assert.match(banner ?? '', /Showing all work/);
  assert.match(banner ?? '', /None of these 2 projects is on a signed deal/);
  assert.match(banner ?? '', /1 has no deal to check/);
  assert.match(banner ?? '', /turns on when signatures start landing/);
});

test('the banner changes the day something is signed', () => {
  const rows = joinDealsToProjects(
    [project('p1'), project('p2')],
    [deal({ id: 'd1', source_project_id: 'p1', ...SIGNED }), deal({ id: 'd2', source_project_id: 'p2' })],
  );

  const banner = signedWorkBanner(summarizeSignedWork(rows), false);
  assert.match(banner ?? '', /1 of 2 projects are on a signed deal/);
  assert.doesNotMatch(banner ?? '', /None of these/);
});

test('the banner goes away when there is nothing to warn about', () => {
  // A banner that never disappears is a banner people stop reading.
  const allSigned = joinDealsToProjects(
    [project('p1')],
    [deal({ source_project_id: 'p1', ...SIGNED })],
  );

  assert.equal(signedWorkBanner(summarizeSignedWork(allSigned), true), null);
  assert.equal(signedWorkBanner(summarizeSignedWork([]), false), null);
});

test('with the filter on the banner says what it is hiding', () => {
  const rows = joinDealsToProjects(
    [project('p1'), project('p2')],
    [deal({ id: 'd1', source_project_id: 'p1', ...SIGNED }), deal({ id: 'd2', source_project_id: 'p2' })],
  );

  assert.match(
    signedWorkBanner(summarizeSignedWork(rows), true) ?? '',
    /Showing signed work only\. 1 unsigned project is hidden\./,
  );
});
