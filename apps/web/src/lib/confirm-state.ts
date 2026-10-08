/**
 * The two-step before something that affects a person.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT A MODAL
 *
 * Twelve destructive server actions and not one confirmation between them: a
 * mis-tap revoked a crew member's access, or removed them from a job, in a
 * single click. On a phone, in a list of similar rows, with the button beside
 * ones that do something harmless.
 *
 * The fix is a second deliberate act, not a dialog. A modal layer traps focus,
 * needs its own escape handling, and on the field screens stacks on top of a
 * flow somebody is already halfway through — §18's "avoid workflows requiring
 * multiple modal layers". Arming the button in place costs one click, says what
 * will happen, and leaves the form exactly where it was.
 *
 * WHY THE STATE IS HERE
 *
 * So the rules can be tested without a browser, and so the thing that matters
 * most — **an armed button disarms itself rather than staying armed forever** —
 * is a rule rather than an implementation detail. A button left armed is a
 * button that fires on the next stray click, which is the problem again with
 * an extra step in front of it.
 * ---------------------------------------------------------------------------
 */

export type ConfirmPhase = 'idle' | 'armed';

/**
 * How long an armed button waits before giving up.
 *
 * Long enough to read the consequence and decide; short enough that walking
 * away from the screen does not leave a loaded control behind.
 */
export const ARM_TIMEOUT_MS = 6_000;

export interface ConfirmCopy {
  /** The resting label — "Revoke access". */
  idle: string;
  /** What the armed button says. Names the consequence, not "Are you sure?". */
  armed: string;
  /** Whether this can be undone, said plainly. */
  reversible: boolean;
}

/**
 * The sentence shown beside an armed button.
 *
 * Reversibility is stated rather than implied. "Archive" sounds recoverable and
 * "Revoke" sounds permanent, and in this product it is the other way round more
 * often than not — archived records have a screen of their own, and a revoked
 * member can be restored. Saying which is true is the difference between a
 * confirmation and a scare.
 */
export function confirmHint(copy: ConfirmCopy): string {
  return copy.reversible
    ? 'This can be undone afterwards.'
    : 'This cannot be undone.';
}

/** What the control reads right now. */
export function confirmLabel(phase: ConfirmPhase, copy: ConfirmCopy): string {
  return phase === 'armed' ? copy.armed : copy.idle;
}

/**
 * Whether this click should submit.
 *
 * `false` means it armed instead. The caller must not submit on a click that
 * only armed — that would be a confirmation in appearance and a single click in
 * fact, which is worse than none because it looks safe.
 */
export function clickSubmits(phase: ConfirmPhase): boolean {
  return phase === 'armed';
}

export function nextPhase(phase: ConfirmPhase): ConfirmPhase {
  return phase === 'armed' ? 'idle' : 'armed';
}
