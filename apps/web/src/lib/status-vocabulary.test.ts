import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HEALTH_STATUSES,
  LIFECYCLE_STATUSES,
  humanizeStatus,
  isHealthStatus,
  isLifecycleStatus,
  lifecycleLabel,
} from './status-vocabulary.ts';

const LIB = dirname(fileURLToPath(import.meta.url));

/**
 * Lifecycle is a fact; health is a judgement. They were being shown as one.
 */

test('§ every value the project carries is classified as exactly one of the two', () => {
  // `Project.healthStatus` carries six values, two of which — On Hold and
  // Completed — are lifecycle rather than health, because that is what the
  // source emits. This reads the union from the type and fails if a seventh
  // ever arrives unclassified: an unclassified value falls through to neutral
  // and quietly stops being a health signal without anybody deciding that.
  const types = readFileSync(join(LIB, 'data', 'types.ts'), 'utf8');
  const field = types.match(/healthStatus:\s*([^;]+);/);
  assert.ok(field, 'Project.healthStatus has moved or been renamed');

  const declared = [...field[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
  assert.ok(declared.length > 0, 'the healthStatus union is no longer a union of literals');

  for (const value of declared) {
    const health = isHealthStatus(value);
    const lifecycle = isLifecycleStatus(value);
    assert.ok(
      health !== lifecycle,
      `"${value}" is ${health && lifecycle ? 'both' : 'neither'} health nor lifecycle — classify it in status-vocabulary.ts`,
    );
  }
});

test('§ the two vocabularies do not overlap', () => {
  // A value in both lists would be coloured or not depending on which check
  // ran first, which is the conflation this module exists to end.
  const overlap = HEALTH_STATUSES.filter((s) => (LIFECYCLE_STATUSES as readonly string[]).includes(s));
  assert.deepEqual(overlap, []);
});

test('§ only a judgement about the work is a health status', () => {
  // The colours are reserved for these four. Nothing else may claim them.
  assert.deepEqual([...HEALTH_STATUSES], ['On Track', 'Attention Needed', 'At Risk', 'Delayed']);
  assert.equal(isHealthStatus('On Hold'), false, 'paused is not unhealthy');
  assert.equal(isHealthStatus('Completed'), false, 'finished is not a judgement');
  assert.equal(isHealthStatus('awarded'), false);
  assert.equal(isHealthStatus(''), false);
});

test('§ a raw status token is shown as words, and is never rewritten', () => {
  // Presentation only. Mapping one vocabulary onto another is how a project
  // ends up described by a word nobody recorded about it.
  assert.equal(humanizeStatus('draft_ready'), 'Draft ready');
  assert.equal(humanizeStatus('awarded'), 'Awarded');
  assert.equal(humanizeStatus('change-order'), 'Change order');
  assert.equal(humanizeStatus('Already Written'), 'Already Written', 'left alone');
  // An unrecognised status still renders as itself rather than being blanked.
  assert.equal(humanizeStatus('some_future_stage'), 'Some future stage');
});

test('§ an absent lifecycle says so rather than showing nothing', () => {
  // A row with no word where a status goes reads as a rendering failure.
  assert.equal(lifecycleLabel(''), 'No status');
  assert.equal(lifecycleLabel('   '), 'No status');
  assert.equal(lifecycleLabel(null), 'No status');
  assert.equal(lifecycleLabel(undefined), 'No status');
  assert.equal(lifecycleLabel('active'), 'Active');
});

test('§ one implementation, so one project is not two words on two screens', () => {
  // The dashboard printed BuildSuite's `awarded` verbatim while the pipeline
  // printed `Awarded`, through a different function of the same name.
  const pipeline = readFileSync(join(LIB, 'pipeline-view.ts'), 'utf8');
  const types = readFileSync(join(LIB, 'data', 'types.ts'), 'utf8');
  assert.match(pipeline, /from '\.\/status-vocabulary\.ts'/, 'pipeline-view defines its own again');
  assert.match(types, /humanizeStatus\(/, 'stageLabel(project) stopped humanising');
  assert.doesNotMatch(
    pipeline,
    /function humanize\(/,
    'humanize has been redefined locally — there must be one of it',
  );
});
