/**
 * The BuildSuite-backed data source.
 *
 * Two things are being pinned here, and the second is the one that would hurt:
 *
 *   1. **Nothing is invented.** BuildSuite has no progress, no health, no
 *      contract value and no visibility switches. A mapping that quietly filled
 *      those in would put "0% · On Track · $0" on a contractor's dashboard and
 *      call it their book of work.
 *   2. **The switches fail closed.** A real project arriving with
 *      `clientPortalEnabled` true would publish a live job to a homeowner that
 *      nobody had decided to publish.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BuildSuiteDataSource } from './buildsuite-source.ts';
import type { BuildSuiteProjectRow, BuildSuiteReader } from '../buildsuite/projects.ts';
import { TenancyError, type TenantScope } from '../tenancy.ts';
import { hasFinancials, hasOperationalDetail, isActiveProject, stageLabel } from './types.ts';

const LOCATION = 'IifYfP2B2NUaoDPdsTTa';
const PROFILE_A = '1dca7b15-9904-449b-a702-5725a5d1b069';
const PROFILE_B = 'a4502e38-bb67-420b-a7fc-3e1bc3d99c01';

const scope: TenantScope = { locationId: LOCATION, authProfileIds: [PROFILE_A, PROFILE_B] };

/** Shaped after a real row: street_address, trade, exact_budget and the
 *  opportunity id are all empty on every live row today. */
function row(over: Partial<BuildSuiteProjectRow> = {}): BuildSuiteProjectRow {
  return {
    id: '80ef9efa-62b5-4d54-9ac3-d7940ea42e87',
    title: 'john home',
    status: 'active',
    source: 'contractor',
    created_at: '2026-07-14T21:45:26.230709+00:00',
    updated_at: '2026-07-15T09:00:00.000000+00:00',
    street_address: null,
    city: 'everett',
    state: 'Washington',
    postal_code: '98006',
    trade: '',
    project_type: null,
    budget_band: '$50,000 - $100,000',
    exact_budget: null,
    start_date: '2026-07-16',
    end_date: '2026-07-31',
    client_name: 'Chris Carr',
    ghl_contact_id: '75EKZfvKvwVDmYAazj7w',
    ghl_opportunity_id: null,
    auth_profile_id: PROFILE_B,
    ...over,
  };
}

function readerOf(rows: BuildSuiteProjectRow[]): BuildSuiteReader {
  return {
    available: true,
    async listProjectRows(s) {
      // Mirror the real filter so an unscoped call is visible in tests too.
      if (s.authProfileIds.length === 0) throw new TenancyError('no scope');
      return rows.filter((r) => s.authProfileIds.includes(r.auth_profile_id ?? ''));
    },
    async listProjectRowsForContact(contactId) {
      return contactId.trim() === '' ? [] : rows.filter((r) => r.ghl_contact_id === contactId);
    },
    async listProjectRowsByIds(projectIds) {
      const wanted = new Set(projectIds.filter((id) => id.trim() !== ''));
      return wanted.size === 0 ? [] : rows.filter((r) => wanted.has(r.id));
    },
    async listActiveProjects() {
      throw new Error('not used by the data source');
    },
    async countByStatus() {
      throw new Error('not used by the data source');
    },
    async listAuthProfileIdsForLocation() {
      throw new Error('not used by the data source');
    },
  };
}

function sourceOf(rows: BuildSuiteProjectRow[]): BuildSuiteDataSource {
  return new BuildSuiteDataSource(readerOf(rows), LOCATION);
}

// ── Nothing invented ─────────────────────────────────────────────────────────

test('a BuildSuite project carries no stage, progress, health or money', async () => {
  const [project] = await sourceOf([row()]).listProjects(scope);
  assert.ok(project);

  assert.equal(project.provenance, 'buildsuite');
  // No §7 stage: BuildSuite's vocabulary is its own and no mapping is defined.
  assert.equal(project.projectStage, undefined);
  assert.equal(project.sourceStatus, 'active');
  assert.equal(stageLabel(project), 'active');

  assert.equal(project.progressPercentage, 0);
  assert.equal(hasOperationalDetail(project), false);
  assert.equal(hasFinancials(project), false);
});

test('the budget band is carried verbatim and never turned into a number', async () => {
  const [project] = await sourceOf([row()]).listProjects(scope);
  assert.ok(project);

  assert.equal(project.budgetBand, '$50,000 - $100,000');
  // The tempting bug: parsing a midpoint out of the band.
  assert.equal(project.contractAmount, 0);
  assert.equal(project.currentProjectTotal, 0);
  assert.equal(project.originalEstimate, 0);
});

test('§9.3 internal fields are zero, never guessed', async () => {
  const [project] = await sourceOf([row()]).listProjects(scope);
  assert.ok(project);

  assert.equal(project.internalMarkup, 0);
  assert.equal(project.margin, 0);
  assert.equal(project.internalNotes, '');
  assert.equal(project.delayReason, '');
});

// ── Failing closed ───────────────────────────────────────────────────────────

test('every client-visibility switch is off', async () => {
  const [project] = await sourceOf([row()]).listProjects(scope);
  assert.ok(project);

  for (const key of [
    'clientPortalEnabled',
    'showBudgetToClient',
    'showDetailedPricing',
    'showScheduleToClient',
    'showAssignedTeam',
    'allowClientMessaging',
    'allowIssueSubmission',
    'allowFileUploads',
  ] as const) {
    assert.equal(project[key], false, `${key} must default off`);
  }
});

test('records BuildSuite does not hold come back empty, not as fixtures', async () => {
  const source = sourceOf([row()]);

  assert.deepEqual(await source.listDailyUpdates(scope), []);
  assert.deepEqual(await source.listIssues(scope), []);
  assert.deepEqual(await source.listTasks(scope), []);
  assert.deepEqual(await source.listMilestones(scope, row().id), []);
});

test('the reads BuildSuite does not serve still refuse an absent scope', async () => {
  const source = sourceOf([row()]);
  const bad = null as unknown as TenantScope;

  await assert.rejects(() => source.listDailyUpdates(bad), TenancyError);
  await assert.rejects(() => source.listIssues(bad), TenancyError);
  await assert.rejects(() => source.listTasks(bad), TenancyError);
  await assert.rejects(() => source.listMilestones(bad, 'x'), TenancyError);
});

// ── Tenancy ──────────────────────────────────────────────────────────────────

test('another agency’s project is never returned', async () => {
  const mine = row({ id: 'mine', auth_profile_id: PROFILE_A });
  const theirs = row({ id: 'theirs', auth_profile_id: '7726102a-8e13-4006-889d-d68bc1cccd40' });

  const projects = await sourceOf([mine, theirs]).listProjects(scope);

  assert.deepEqual(
    projects.map((p) => p.buildsuiteProjectId),
    ['mine'],
  );
});

test('getProject cannot reach outside the scope', async () => {
  const mine = row({ id: 'mine', auth_profile_id: PROFILE_A });
  const theirs = row({ id: 'theirs', auth_profile_id: '7726102a-8e13-4006-889d-d68bc1cccd40' });
  const source = sourceOf([mine, theirs]);

  assert.ok(await source.getProject(scope, 'mine'));
  assert.equal(await source.getProject(scope, 'theirs'), null);
});

test('an unscoped listing raises rather than returning everything', async () => {
  const source = sourceOf([row()]);
  await assert.rejects(() => source.listProjects(null as unknown as TenantScope), TenancyError);
});

// ── Mapping details measured against live rows ───────────────────────────────

test('the address is built from what exists, with no empty separators', async () => {
  // street_address is null on every live row.
  const [project] = await sourceOf([row()]).listProjects(scope);
  assert.ok(project);

  assert.equal(project.projectAddress, 'everett, Washington, 98006');
});

test('timestamps are reduced to the date the screens display', async () => {
  const [project] = await sourceOf([row()]).listProjects(scope);
  assert.ok(project);

  assert.equal(project.lastUpdatedDate, '2026-07-15');
  assert.equal(project.estimatedStartDate, '2026-07-16');
  assert.equal(project.estimatedCompletionDate, '2026-07-31');
});

test('an empty title reads as untitled rather than blank', async () => {
  const [a] = await sourceOf([row({ title: '' })]).listProjects(scope);
  const [b] = await sourceOf([row({ title: null })]).listProjects(scope);

  assert.equal(a?.projectName, 'Untitled project');
  assert.equal(b?.projectName, 'Untitled project');
});

test('completed and draft work is classified without a §7 stage', async () => {
  const [done] = await sourceOf([row({ status: 'completed' })]).listProjects(scope);
  const [draft] = await sourceOf([row({ status: 'draft' })]).listProjects(scope);
  assert.ok(done && draft);

  assert.equal(isActiveProject(done), false);
  assert.equal(done.healthStatus, 'Completed');
  // A draft is unstarted, not finished — it still counts as live work.
  assert.equal(isActiveProject(draft), true);
});

// ── §1.4: a contact may hold several projects ────────────────────────────────

test('a contact resolves to every project they hold', async () => {
  const one = row({ id: 'one', ghl_contact_id: 'contact-x' });
  const two = row({ id: 'two', ghl_contact_id: 'contact-x' });
  const other = row({ id: 'other', ghl_contact_id: 'contact-y' });
  const source = sourceOf([one, two, other]);

  const projects = await source.listProjectsForContact('contact-x');
  assert.deepEqual(
    projects.map((p) => p.buildsuiteProjectId),
    ['one', 'two'],
  );

  const contact = await source.getContact('contact-x');
  assert.equal(contact?.projectIds.length, 2);
});

test('an empty contact id returns nothing rather than the whole table', async () => {
  const source = sourceOf([row()]);

  assert.deepEqual(await source.listProjectsForContact(''), []);
  assert.equal(await source.getContact(''), null);
});

test('a contact with no projects is null, not an empty shell', async () => {
  assert.equal(await sourceOf([row()]).getContact('nobody'), null);
});
