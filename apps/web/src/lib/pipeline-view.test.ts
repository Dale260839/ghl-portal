/**
 * The pipeline view model.
 *
 * The reader's tests cover whether the numbers are right. These cover whether
 * the *screen* tells the truth about them — which is a different question, and
 * the one this sprint exists to answer. A funnel that renders honestly-sourced
 * numbers misleadingly is still a misleading screen.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildFunnel, normalizeDeal, type BuildSuiteDealRow, type Deal } from './buildsuite/deals.ts';
import {
  AGE_BANDS,
  ageBand,
  budgetLabel,
  buildPipelineView,
  humanize,
  pipelineHeadline,
  stageLabel,
} from './pipeline-view.ts';

const NOW = new Date('2026-08-28T12:00:00Z');

/** `days` ago, so the age a row reports is the age the test asked for. */
function deal(days: number, over: Partial<BuildSuiteDealRow> = {}): Deal {
  const at = new Date(NOW.getTime() - days * 86_400_000).toISOString();
  return normalizeDeal({
    id: `deal-${days}-${over.status ?? 'draft_ready'}`,
    status: 'draft_ready',
    source: 'ghl_project_quote_survey',
    created_at: at,
    updated_at: at,
    auth_profile_id: 'profile-a',
    source_project_id: null,
    matched_contractor_id: null,
    sent_to_crm_at: null,
    signature_status: null,
    signature_signed_at: null,
    client_name: 'Chris Carr',
    project_type: 'kitchen',
    budget_range: '$50,000 - $100,000',
    ghl_contact_id: null,
    ghl_opportunity_id: null,
    coverage_score: null,
    ...over,
  });
}

const viewOf = (deals: Deal[]) => buildPipelineView(deals, buildFunnel(deals, deals.length), NOW);

// ── Age bands ────────────────────────────────────────────────────────────────

test('the bands split at their boundaries, inclusive at the top', () => {
  assert.equal(ageBand(0), 'fresh');
  assert.equal(ageBand(AGE_BANDS.stalled - 1), 'fresh');
  assert.equal(ageBand(AGE_BANDS.stalled), 'stalled');
  assert.equal(ageBand(AGE_BANDS.dormant - 1), 'stalled');
  assert.equal(ageBand(AGE_BANDS.dormant), 'dormant');
  assert.equal(ageBand(174), 'dormant');
});

test('bands exist because a single threshold would flag almost everything', () => {
  // The live Alliance spread, 2026-08-28: 20 of 23 already past a month. A
  // binary stalled flag paints 87% of the board one colour, which is the same as
  // painting none of it. This pins that the bands actually separate that set.
  const live = [174, 173, 173, 172, 172, 162, 162, 160, 156, 153, 141, 133, 129, 97, 94, 89, 72, 44, 40, 37, 2, 1, 1];
  const view = viewOf(live.map((d) => deal(d)));

  assert.equal(view.total, 23);
  assert.equal(view.aging.fresh, 3, 'the three recent ones');
  assert.equal(view.aging.stalled, 3, '37, 40 and 44 days');
  assert.equal(view.aging.dormant, 17, 'past 60 days');
  assert.equal(view.oldestDays, 174);
});

// ── The bars ─────────────────────────────────────────────────────────────────

test('the busiest stage fills the row and the rest are relative to it', () => {
  const view = viewOf([
    ...Array.from({ length: 16 }, (_, i) => deal(i + 1, { status: 'draft_ready' })),
    ...Array.from({ length: 4 }, (_, i) => deal(i + 20, { status: 'intake_started' })),
  ]);

  const draft = view.bars.find((b) => b.stage === 'draft_ready');
  const intake = view.bars.find((b) => b.stage === 'intake_started');
  assert.equal(draft?.width, 100);
  assert.equal(intake?.width, 25);
});

test('an empty tenant renders zero-width bars rather than NaN', () => {
  // 0/0 in a width would reach the style attribute as NaN, which a browser
  // treats as no width set — and the bar would render full, saying the opposite
  // of the truth.
  const view = viewOf([]);

  assert.equal(view.total, 0);
  assert.ok(view.bars.length > 0, 'the stages still render, just empty');
  for (const bar of view.bars) {
    assert.equal(bar.width, 0);
    assert.ok(Number.isFinite(bar.width));
  }
  assert.equal(view.oldestDays, 0);
});

test('an unrecognised stage still gets a readable label and a bar', () => {
  const view = viewOf([deal(5, { status: 'awaiting_deposit' })]);

  const bar = view.bars.find((b) => b.stage === 'awaiting_deposit');
  assert.ok(bar, 'a status BuildSuite invented vanished from the screen');
  assert.equal(bar.label, 'Awaiting deposit');
  assert.equal(bar.known, false);
});

test('stage labels are words, not tokens', () => {
  assert.equal(stageLabel('draft_ready'), 'Draft ready');
  assert.equal(stageLabel('questions_in_progress'), 'Questions in progress');
  assert.equal(stageLabel('unknown'), 'Unknown');
  assert.equal(stageLabel(''), 'No status');
});

test('every budget vocabulary in the live table renders as money', () => {
  // BuildSuite has two in the same column — measured across 182 deals, 101 use
  // tokens and 37 are already written out. Presumably two intake forms.
  assert.equal(budgetLabel('5k_10k'), '$5k – $10k');
  assert.equal(budgetLabel('10k_25k'), '$10k – $25k');
  assert.equal(budgetLabel('25k_50k'), '$25k – $50k');
  assert.equal(budgetLabel('50k_100k'), '$50k – $100k');
  assert.equal(budgetLabel('under_5k'), 'Under $5k');
  assert.equal(budgetLabel('100k_plus'), '$100k+');
});

test('a budget already written as money is passed through untouched', () => {
  // Reformatting these is how `$250,000+` becomes something subtly wrong.
  for (const written of [
    '$15,000 - $50,000',
    '$5,000 - $15,000',
    '$50,000 - $100,000',
    '$100,000 - $250,000',
    '$250,000+',
    'Under $2,000',
  ]) {
    assert.equal(budgetLabel(written), written);
  }
});

test('a missing budget says so, and an unparseable one is still shown', () => {
  // 22 of 182 are empty. A band we cannot parse is still information.
  assert.equal(budgetLabel(''), 'No budget given');
  assert.equal(budgetLabel('   '), 'No budget given');
  assert.equal(budgetLabel('to_be_discussed'), 'To be discussed');
});

test('project types render as words on the row', () => {
  assert.equal(humanize('general_remodel'), 'General remodel');
  assert.equal(humanize('deck_exterior'), 'Deck exterior');

  const view = viewOf([deal(1, { project_type: 'general_remodel', budget_range: '10k_25k' })]);
  assert.equal(view.rows[0].projectType, 'General remodel');
  assert.equal(view.rows[0].budgetRange, '$10k – $25k');
});

// ── The rows ─────────────────────────────────────────────────────────────────

test('deals are listed oldest first', () => {
  // A recency sort buries the thing the screen exists to show.
  const view = viewOf([deal(3), deal(120), deal(45)]);

  assert.deepEqual(
    view.rows.map((r) => r.days),
    [120, 45, 3],
  );
});

test('a row carries whether it reached a project, and which', () => {
  const view = viewOf([deal(10, { source_project_id: 'BSP-2026-000184' })]);

  assert.equal(view.rows[0].linkedToProject, true);
  assert.equal(view.rows[0].projectId, 'BSP-2026-000184');
});

test('a nameless client reads as unnamed rather than as a blank row', () => {
  const view = viewOf([deal(1, { client_name: '' })]);

  assert.equal(view.rows[0].clientName, 'Unnamed client');
});

// ── Milestones ───────────────────────────────────────────────────────────────

test('the milestones are separate from the bars, because they are not stages', () => {
  // A signed deal still has a status. Adding "signed" to the bars would count it
  // twice and the funnel would stop summing to the total.
  const view = viewOf([
    deal(10, { status: 'draft_ready', signature_signed_at: '2026-08-20T09:00:00Z' }),
  ]);

  assert.equal(view.bars.reduce((sum, b) => sum + b.count, 0), view.total);
  assert.equal(view.bars.some((b) => b.stage === 'signed'), false);
  assert.equal(view.milestones.find((m) => m.key === 'signed')?.count, 1);
});

test('a zero milestone explains itself and a non-zero one drops the caption', () => {
  // "No proposal has left BuildSuite" is true today and a lie the day one does.
  const empty = viewOf([deal(10)]);
  assert.match(
    empty.milestones.find((m) => m.key === 'signed')?.note ?? '',
    /nothing has been signed/i,
  );

  const signed = viewOf([deal(10, { signature_signed_at: '2026-08-20T09:00:00Z' })]);
  assert.equal(
    signed.milestones.find((m) => m.key === 'signed')?.note,
    null,
    'the zero-caption outlived its zero',
  );
});

// ── The headline ─────────────────────────────────────────────────────────────

test('the headline states the finding plainly', () => {
  const live = [174, 173, 97, 44, 2];
  const headline = pipelineHeadline(viewOf(live.map((d) => deal(d))));

  assert.match(headline, /5 deals/);
  assert.match(headline, /4 not moved in 14\+ days/);
  assert.match(headline, /3 past 60 days/);
  assert.match(headline, /none signed/);
});

test('the headline stops saying "none signed" the day one is', () => {
  const headline = pipelineHeadline(
    viewOf([deal(2), deal(3, { signature_signed_at: '2026-08-26T09:00:00Z' })]),
  );

  assert.match(headline, /1 signed/);
  assert.doesNotMatch(headline, /none signed/);
});

test('an empty tenant gets a sentence, not a row of zeros', () => {
  assert.equal(pipelineHeadline(viewOf([])), 'No deals for this contractor yet.');
});

test('the coverage caveat reaches the view', () => {
  // deals.auth_profile_id is ~53% populated, so the count undercounts. The
  // screen must carry that rather than presenting the number as complete.
  assert.match(viewOf([deal(1)]).coverageNote, /auth profile/i);
});
