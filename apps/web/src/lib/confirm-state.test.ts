import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ARM_TIMEOUT_MS,
  clickSubmits,
  confirmHint,
  confirmLabel,
  nextPhase,
} from './confirm-state.ts';

/**
 * The second act in front of something that affects a person.
 *
 * Twelve destructive server actions had no confirmation at all — a mis-tap in a
 * list of similar rows revoked a crew member's access in one click.
 */

const revoke = { idle: 'Revoke', armed: 'Revoke now', reversible: true };

test('§ the click that arms must NOT submit', () => {
  // The whole guarantee. A confirmation that submits on the first click looks
  // safe and is not, which is worse than having none — people stop reading a
  // control they believe will ask.
  assert.equal(clickSubmits('idle'), false);
  assert.equal(clickSubmits('armed'), true);
});

test('§ arming is reversible, by clicking again or by cancelling', () => {
  assert.equal(nextPhase('idle'), 'armed');
  assert.equal(nextPhase('armed'), 'idle');
});

test('§ the armed label names the act rather than asking a question', () => {
  // "Are you sure?" tests resolve. "Revoke now" tells somebody what the next
  // click does, which is the only thing they need to know.
  assert.equal(confirmLabel('idle', revoke), 'Revoke');
  assert.equal(confirmLabel('armed', revoke), 'Revoke now');
});

test('§ reversibility is stated, not implied by the verb', () => {
  // "Archive" sounds recoverable and "Revoke" sounds permanent; in this product
  // archived records have a screen of their own and a revoked member can be
  // restored, so the verb is a poor guide and the sentence is not.
  assert.equal(confirmHint({ ...revoke, reversible: true }), 'This can be undone afterwards.');
  assert.equal(confirmHint({ ...revoke, reversible: false }), 'This cannot be undone.');
});

test('§ an armed control gives up rather than waiting indefinitely', () => {
  // A button left armed is the original problem with a step in front of it:
  // the next stray click fires it. Long enough to read, short enough that
  // walking away does not leave a loaded control behind.
  assert.ok(ARM_TIMEOUT_MS >= 3_000, 'too short to read the consequence');
  assert.ok(ARM_TIMEOUT_MS <= 15_000, 'long enough to forget it is armed');
});
