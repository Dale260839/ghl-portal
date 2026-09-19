import assert from 'node:assert/strict';
import test from 'node:test';

import { columnSupport, resetColumnSupport } from './column-support.ts';

/**
 * Asking the database whether a column is there yet.
 *
 * Migrations are run by hand and code ships on push, so the app is routinely
 * ahead of the database. The rule is that the newer feature degrades and the
 * older one keeps working — never that a crew member's photo is refused
 * because a migration is pending.
 */

function probe(answer: 'ok' | 'missing') {
  const calls: unknown[] = [];
  const client = {
    async select(args: unknown) {
      calls.push(args);
      if (answer === 'missing') throw new Error('column hub_photos.task_id does not exist');
      return [];
    },
  };
  return { calls, client: client as never };
}

test('a column that is there is reported, and asked about once per process', async () => {
  resetColumnSupport();
  const { calls, client } = probe('ok');
  assert.equal(await columnSupport(client, 'hub_photos', ['task_id']), true);
  assert.equal(await columnSupport(client, 'hub_photos', ['task_id']), true);
  assert.equal(calls.length, 1, 'the answer is cached — one read per process, not per write');
  assert.deepEqual(calls[0], { from: 'hub_photos', columns: ['task_id'], limit: 0 });
});

test('a column that is missing is reported false rather than thrown', async () => {
  resetColumnSupport();
  const { client } = probe('missing');
  assert.equal(await columnSupport(client, 'hub_photos', ['task_id']), false);
});

test('each table and column set is asked about separately', async () => {
  resetColumnSupport();
  const { calls, client } = probe('ok');
  await columnSupport(client, 'hub_photos', ['task_id']);
  await columnSupport(client, 'hub_daily_updates', ['task_id']);
  await columnSupport(client, 'hub_visibility_settings', ['allow_file_uploads', 'allow_issue_submission']);
  assert.equal(calls.length, 3);
  // Order does not make a different question.
  await columnSupport(client, 'hub_visibility_settings', ['allow_issue_submission', 'allow_file_uploads']);
  assert.equal(calls.length, 3);
});
