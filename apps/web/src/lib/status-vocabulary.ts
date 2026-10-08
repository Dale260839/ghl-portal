/**
 * Two status systems that were being shown as one.
 *
 * ---------------------------------------------------------------------------
 * LIFECYCLE IS NOT HEALTH
 *
 * **Lifecycle** is where a project is in its life: draft, awarded, active, on
 * hold, completed. It is a fact. Nothing is wrong with a project for being a
 * draft, and colouring it would say otherwise.
 *
 * **Health** is a judgement about whether the work is going to plan: On Track,
 * Attention Needed, At Risk, Delayed. This is what the status colours are for,
 * and it is the only thing they are for.
 *
 * On a project row the two sat side by side — a bare lowercase `awarded` next
 * to a green "On Track" pill — reading as one inconsistent system rather than
 * two different questions.
 *
 * Worse, `Project.healthStatus` ITSELF carries two lifecycle values, `On Hold`
 * and `Completed`, because that is what the source emits. They cannot be
 * removed from the type without dropping data, so they are classified here
 * instead and rendered as the facts they are.
 * ---------------------------------------------------------------------------
 */

/** A judgement about the work. These, and only these, earn a status colour. */
export const HEALTH_STATUSES = ['On Track', 'Attention Needed', 'At Risk', 'Delayed'] as const;

/**
 * Values that arrive in `healthStatus` but describe the project's life rather
 * than its health. Neutral, always.
 */
export const LIFECYCLE_STATUSES = ['On Hold', 'Completed'] as const;

export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export function isHealthStatus(value: string): value is HealthStatus {
  return (HEALTH_STATUSES as readonly string[]).includes(value);
}

export function isLifecycleStatus(value: string): boolean {
  return (LIFECYCLE_STATUSES as readonly string[]).includes(value);
}

/**
 * `draft_ready` → `Draft ready`.
 *
 * Presentation only. It never maps one vocabulary onto another — a status the
 * source invents still renders as words rather than as a raw token, and still
 * renders as itself.
 */
export function humanizeStatus(token: string): string {
  const words = token.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The lifecycle word for a row, ready to show.
 *
 * It was rendered raw: the dashboard printed BuildSuite's own `awarded` in
 * lower case while the pipeline screen printed `Awarded` for the same value,
 * through a different function of the same name. One project, one word, two
 * spellings depending on which screen you were looking at.
 */
export function lifecycleLabel(raw: string | null | undefined): string {
  const token = (raw ?? '').trim();
  return token === '' ? 'No status' : humanizeStatus(token);
}
