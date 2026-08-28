import { daysStalled, type Deal, type DealFunnel } from './buildsuite/deals.ts';

/**
 * Turning the deal funnel into something a project manager can read.
 *
 * Pure — no request state, no data access, `now` passed in. The page renders
 * what this returns, so the judgements below are testable rather than buried in
 * JSX.
 *
 * ---------------------------------------------------------------------------
 * TWO THINGS THIS SCREEN MUST NOT IMPLY
 *
 *  1. **It is occupancy, not flow.** A funnel chart normally means "how many
 *     reached this step". All we have is `status`, which says where a deal is
 *     *now*. A deal that moved from `draft_ready` to `proposal_sent` leaves the
 *     first count entirely. Labelled "where deals are now" for that reason.
 *
 *  2. **Signed and sent-to-CRM are not stages.** They are flags that cut across
 *     `status`, so adding them to the bars would double-count. They render as a
 *     separate row.
 * ---------------------------------------------------------------------------
 */

/**
 * Age bands, chosen from the live spread rather than picked round.
 *
 * Measured 2026-08-28 across the Alliance tenant: 20 of 23 deals were already
 * past 30 days, the median `draft_ready` deal was 97 days old and the oldest was
 * 174. A single stalled/not-stalled flag at any threshold flags ~87% of the
 * board, and a screen where almost everything is highlighted has highlighted
 * nothing. So the useful question is not *whether* a deal is stalled but *how
 * badly*, and that needs bands.
 */
export const AGE_BANDS = {
  /** Below this, a deal is simply in progress. */
  stalled: 14,
  /** Beyond this it is not slow, it is abandoned until someone says otherwise. */
  dormant: 60,
} as const;

export type AgeBand = 'fresh' | 'stalled' | 'dormant';

export function ageBand(days: number): AgeBand {
  if (days >= AGE_BANDS.dormant) return 'dormant';
  if (days >= AGE_BANDS.stalled) return 'stalled';
  return 'fresh';
}

/** `general_remodel` → `General remodel`. Snake tokens are not a UI vocabulary. */
export function humanize(token: string): string {
  const words = token.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * `draft_ready` → `Draft ready`. Applied to unrecognised statuses too, so a
 * value BuildSuite invents still renders as words rather than as a raw token.
 */
export function stageLabel(stage: string): string {
  return stage === '' ? 'No status' : humanize(stage);
}

/**
 * Budget bands, of which BuildSuite has **two vocabularies in the same column**.
 *
 * Measured across 182 deals: 101 use tokens (`5k_10k`, `under_5k`, `100k_plus`),
 * 37 are already written out (`$15,000 - $50,000`, `Under $2,000`, `$250,000+`)
 * and 22 are empty. Presumably two intake forms written at different times.
 *
 * So this normalizes the token form and **passes the currency form through
 * untouched** — reformatting a string someone already wrote as money is how you
 * turn `$250,000+` into something subtly wrong. Anything unrecognised falls back
 * to `humanize` rather than being blanked, because a band we cannot parse is
 * still information.
 */
export function budgetLabel(raw: string): string {
  if (raw.trim() === '') return 'No budget given';
  if (raw.includes('$')) return raw.trim();

  const token = raw.trim().toLowerCase();
  const amount = (n: string) => `$${n}k`;

  const under = token.match(/^under[_-](\d+)k$/);
  if (under !== null) return `Under ${amount(under[1])}`;

  const plus = token.match(/^(\d+)k[_-]plus$/);
  if (plus !== null) return `${amount(plus[1])}+`;

  const band = token.match(/^(\d+)k[_-](\d+)k$/);
  if (band !== null) return `${amount(band[1])} – ${amount(band[2])}`;

  return humanize(raw);
}

export interface StageBar {
  stage: string;
  label: string;
  count: number;
  /** 0–100, relative to the busiest stage, so the widest bar fills the row. */
  width: number;
  known: boolean;
}

export interface DealRow {
  id: string;
  clientName: string;
  /** Humanized — `general_remodel` renders as `General remodel`. */
  projectType: string;
  /** Humanized, and tolerant of both of BuildSuite's budget vocabularies. */
  budgetRange: string;
  stage: string;
  stageLabel: string;
  days: number;
  band: AgeBand;
  linkedToProject: boolean;
  projectId: string | null;
  matched: boolean;
  signed: boolean;
}

export interface Milestone {
  key: 'matched' | 'proposalSent' | 'signed' | 'sentToCrm' | 'linkedToProject';
  label: string;
  count: number;
  /**
   * What it means that this is zero — and **null once it is not**.
   *
   * "No proposal has left BuildSuite" is true today and becomes a lie the day
   * one does. Nulling it here rather than trusting the page to hide it means the
   * screen cannot outlive its own caption.
   */
  note: string | null;
}

export interface PipelineView {
  total: number;
  bars: StageBar[];
  milestones: Milestone[];
  rows: DealRow[];
  /** Counts per band, for the headline. */
  aging: { fresh: number; stalled: number; dormant: number };
  /** The single oldest deal's age, or 0 for an empty tenant. */
  oldestDays: number;
  coverageNote: string;
}

export function buildPipelineView(deals: Deal[], funnel: DealFunnel, now: Date): PipelineView {
  const busiest = funnel.stages.reduce((max, s) => Math.max(max, s.count), 0);

  const bars: StageBar[] = funnel.stages.map((s) => ({
    stage: s.stage,
    label: stageLabel(s.stage),
    count: s.count,
    // Guard the divide: an empty tenant has no busiest stage, and 0/0 would put
    // NaN into a style attribute, which silently renders as a full-width bar.
    width: busiest === 0 ? 0 : Math.round((s.count / busiest) * 100),
    known: s.known,
  }));

  const rows: DealRow[] = deals
    .map((deal) => {
      const days = daysStalled(deal, now);
      return {
        id: deal.id,
        clientName: deal.clientName === '' ? 'Unnamed client' : deal.clientName,
        projectType: deal.projectType === '' ? '' : humanize(deal.projectType),
        budgetRange: budgetLabel(deal.budgetRange),
        stage: deal.stage,
        stageLabel: stageLabel(deal.stage),
        days,
        band: ageBand(days),
        linkedToProject: deal.projectId !== null,
        projectId: deal.projectId,
        matched: deal.matched,
        signed: deal.signed,
      };
    })
    // Oldest first. The whole point of the screen is what has stopped moving,
    // and that is not what a recency sort surfaces.
    .sort((a, b) => b.days - a.days);

  const aging = {
    fresh: rows.filter((r) => r.band === 'fresh').length,
    stalled: rows.filter((r) => r.band === 'stalled').length,
    dormant: rows.filter((r) => r.band === 'dormant').length,
  };

  const proposalSent = funnel.stages.find((s) => s.stage === 'proposal_sent')?.count ?? 0;

  /** A caption that only applies while the count is zero. */
  const milestone = (
    key: Milestone['key'],
    label: string,
    count: number,
    whenZero: string,
  ): Milestone => ({ key, label, count, note: count === 0 ? whenZero : null });

  return {
    total: funnel.total,
    bars,
    milestones: [
      milestone(
        'matched',
        'Matched to a contractor',
        funnel.matched,
        'BuildSuite has not paired a contractor to these deals.',
      ),
      milestone('proposalSent', 'Proposal sent', proposalSent, 'No proposal has left BuildSuite.'),
      milestone(
        'signed',
        'Signed',
        funnel.signed,
        'Nothing has been signed, so no project has become real work.',
      ),
      milestone(
        'sentToCrm',
        'Handed to GoHighLevel',
        funnel.sentToCrm,
        'The handoff has never fired for this tenant.',
      ),
      milestone(
        'linkedToProject',
        'Linked to a project record',
        funnel.linkedToProject,
        'No deal has produced a project row.',
      ),
    ],
    rows,
    aging,
    oldestDays: rows.length === 0 ? 0 : rows[0].days,
    coverageNote: funnel.coverage.note,
  };
}

/**
 * The one-line summary above the funnel.
 *
 * Written as a sentence rather than assembled in the page, because the honest
 * version of it changes with the data: "nothing has been signed" is the headline
 * today and must stop being the headline the day that changes.
 */
export function pipelineHeadline(view: PipelineView): string {
  if (view.total === 0) return 'No deals for this contractor yet.';

  const parts = [`${view.total} ${view.total === 1 ? 'deal' : 'deals'}`];
  const notMoving = view.aging.stalled + view.aging.dormant;
  if (notMoving > 0) {
    parts.push(`${notMoving} not moved in ${AGE_BANDS.stalled}+ days`);
  }
  if (view.aging.dormant > 0) {
    parts.push(`${view.aging.dormant} past ${AGE_BANDS.dormant} days`);
  }
  const signed = view.milestones.find((m) => m.key === 'signed')?.count ?? 0;
  parts.push(signed === 0 ? 'none signed' : `${signed} signed`);
  return parts.join(' · ');
}
