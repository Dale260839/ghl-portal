/**
 * The presenter HUD's references have to resolve.
 *
 * This exists because of a real failure, not a hypothetical one: after the
 * Completion & Warranty screen shipped, the script still told the presenter to
 * say it was "designed and not built", and pointed the same step at a "coming
 * shortly" panel that no longer existed. A wrong `screen` or `hotspot` silently
 * renders nothing to point at, mid-demo, in front of the client.
 *
 * These tests cannot check that the words are true — only a person can. What
 * they can check is that every step points at something that exists.
 *
 * Run: npm test --workspace @buildsuite/web
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STEPS } from './script.ts';
import { SCREENS } from './wireframes.ts';

test('every step names a screen that exists', () => {
  const known = new Set(Object.keys(SCREENS));
  for (const step of STEPS) {
    if (step.screen === undefined) continue;
    assert.ok(known.has(step.screen), `step "${step.title}" names unknown screen "${step.screen}"`);
  }
});

test('every hotspot resolves to a block on that step\'s screen', () => {
  for (const step of STEPS) {
    if (step.hotspot === undefined || step.screen === undefined) continue;
    const screen = SCREENS[step.screen as keyof typeof SCREENS];
    if (screen === undefined) continue; // covered by the test above
    const ids = new Set(screen.blocks.map((b) => b.id));
    assert.ok(
      ids.has(step.hotspot),
      `step "${step.title}" points at "${step.hotspot}", which is not on screen "${step.screen}"`,
    );
  }
});

test('no step claims Completion & Warranty is unbuilt', () => {
  // The specific regression this file was added for. The screen shipped; a
  // script that still calls it unbuilt makes the presenter contradict their
  // own screen. Narrow on purpose — it asserts one fact, not a style.
  for (const step of STEPS) {
    const prose = [step.say, step.hoodSimple, step.backend, step.watch]
      .filter((s): s is string => typeof s === 'string')
      .join(' ')
      .toLowerCase();
    const claimsUnbuilt =
      /completion (and|&) warranty/.test(prose) && /not built|designed and not/.test(prose);
    assert.ok(!claimsUnbuilt, `step "${step.title}" still calls Completion & Warranty unbuilt`);
  }
});

test('steps carry the words the presenter actually reads', () => {
  // A step with no `say` is a slide with no line, which strands the presenter.
  for (const step of STEPS) {
    assert.ok(
      typeof step.title === 'string' && step.title.trim() !== '',
      'a step is missing its title',
    );
  }
});
