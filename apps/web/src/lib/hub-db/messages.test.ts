import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HubMessages } from './messages.ts';
import { TenancyError, type TenantScope } from '../tenancy.ts';

const SCOPE: TenantScope = {
  locationId: 'loc-1',
  authProfileIds: ['profile-1'],
  contractorId: 'contractor-1',
};

/** Records every call, so the tests can assert the filters and not just the result. */
function clientOf() {
  const calls: { op: string; args: Record<string, unknown> }[] = [];
  const client = {
    async select(args: Record<string, unknown>) {
      calls.push({ op: 'select', args });
      return [];
    },
    async insert(args: Record<string, unknown>) {
      calls.push({ op: 'insert', args });
      return [{ id: 'new-1', project_id: 'p1', body: 'x', created_at: 'now' }];
    },
    async update(args: Record<string, unknown>) {
      calls.push({ op: 'update', args });
      return [];
    },
  };
  return { calls, messages: new HubMessages(client as never) };
}

test('§ every read is filtered on the asserted contractor', async () => {
  const { calls, messages } = clientOf();
  await messages.listForProject(SCOPE, 'p1');

  const filters = calls[0]!.args.filters as Record<string, string>;
  assert.equal(filters.contractor_id, 'eq.contractor-1');
  assert.equal(filters.project_id, 'eq.p1');
});

test('§ every write is filtered on the asserted contractor too', async () => {
  // Knowing an id must not be enough to publish out of another contractor's
  // thread, or to remove a message from one.
  const { calls, messages } = clientOf();
  await messages.release(SCOPE, 'm1', true);
  await messages.archive(SCOPE, 'm1');
  await messages.post(SCOPE, { projectId: 'p1', body: 'hello' }, { name: 'A', role: 'contractor' });

  assert.equal((calls[0]!.args.filters as Record<string, string>).contractor_id, 'eq.contractor-1');
  assert.equal((calls[1]!.args.filters as Record<string, string>).contractor_id, 'eq.contractor-1');
  assert.equal(
    ((calls[2]!.args.rows as Record<string, unknown>[])[0])!.contractor_id,
    'contractor-1',
  );
});

test('§ a scope with no contractor reads and writes nothing rather than everything', async () => {
  const { messages } = clientOf();
  const noContractor: TenantScope = { locationId: 'loc-1', authProfileIds: ['profile-1'] };

  await assert.rejects(() => messages.listForProject(noContractor, 'p1'), TenancyError);
  await assert.rejects(
    () => messages.post(noContractor, { projectId: 'p1', body: 'x' }, { name: 'A', role: 'contractor' }),
    TenancyError,
  );
  await assert.rejects(() => messages.release(noContractor, 'm1', true), TenancyError);
  await assert.rejects(() => messages.archive(noContractor, 'm1'), TenancyError);
});

test('archived messages never appear in a list', async () => {
  const { calls, messages } = clientOf();
  await messages.listForProject(SCOPE, 'p1');

  assert.equal((calls[0]!.args.filters as Record<string, string>).archived_at, 'is.null');
});

test('a thread reads oldest first and is capped', async () => {
  const { calls, messages } = clientOf();
  await messages.listForProject(SCOPE, 'p1');

  assert.equal(calls[0]!.args.order, 'created_at.asc');
  assert.equal(calls[0]!.args.limit, 500);
});

test('the released-only read filters in the query, not afterwards', async () => {
  // A read that fetched everything and filtered in JavaScript would put
  // internal text one forgotten `.filter()` away from a homeowner's screen.
  const { calls, messages } = clientOf();
  await messages.listForProject(SCOPE, 'p1', { clientVisibleOnly: true });

  assert.equal((calls[0]!.args.filters as Record<string, string>).client_visible, 'is.true');
});

test('the contractor read is not filtered on visibility, so held-back messages still show', () => {
  // The control screen exists to show what the client cannot see.
  const { calls, messages } = clientOf();
  return messages.listForProject(SCOPE, 'p1').then(() => {
    assert.equal((calls[0]!.args.filters as Record<string, string>).client_visible, undefined);
  });
});

test('an empty body is refused', async () => {
  const { messages } = clientOf();
  await assert.rejects(
    () => messages.post(SCOPE, { projectId: 'p1', body: '   ' }, { name: 'A', role: 'contractor' }),
    TypeError,
  );
  await assert.rejects(
    () => messages.post(SCOPE, { projectId: '', body: 'hello' }, { name: 'A', role: 'contractor' }),
    TypeError,
  );
});

test('a new message is internal until someone releases it', async () => {
  // A default of on would publish a note nobody had decided to send.
  const { calls, messages } = clientOf();
  await messages.post(SCOPE, { projectId: 'p1', body: 'Framing runs late' }, { name: 'Ralph', role: 'contractor' });

  const row = (calls[0]!.args.rows as Record<string, unknown>[])[0]!;
  assert.equal(row.client_visible, false);
  assert.equal(row.author, 'Ralph');
  assert.equal(row.author_role, 'contractor');
  assert.equal(row.body, 'Framing runs late');
});

test('a field note is stored internal', async () => {
  const { calls, messages } = clientOf();
  await messages.post(SCOPE, { projectId: 'p1', body: 'Need a decision' }, { name: 'Mia', role: 'field' });

  assert.equal((calls[0]!.args.rows as Record<string, unknown>[])[0]!.client_visible, false);
});

test('a client reply is always client-visible, whatever the caller passed', async () => {
  // A homeowner cannot be shown a thread that hides their own words back from
  // them, so this is forced rather than trusted to the call site.
  const { calls, messages } = clientOf();
  await messages.post(
    SCOPE,
    { projectId: 'p1', body: 'Thanks', clientVisible: false },
    { name: 'Dana', role: 'client' },
  );

  const row = (calls[0]!.args.rows as Record<string, unknown>[])[0]!;
  assert.equal(row.client_visible, true);
  assert.equal(row.author_role, 'client');
});

test('releasing and withdrawing are both possible', async () => {
  // `false` must reach the database as false, not be dropped as falsy —
  // otherwise withdrawing a message silently does nothing.
  const { calls, messages } = clientOf();
  await messages.release(SCOPE, 'm1', true);
  await messages.release(SCOPE, 'm1', false);

  assert.equal((calls[0]!.args.patch as Record<string, unknown>).client_visible, true);
  assert.equal((calls[1]!.args.patch as Record<string, unknown>).client_visible, false);
});

test('removal archives rather than deletes', async () => {
  const { calls, messages } = clientOf();
  await messages.archive(SCOPE, 'm1');

  assert.equal(calls[0]!.op, 'update', 'a delete would lose that the message existed');
  assert.ok((calls[0]!.args.patch as Record<string, unknown>).archived_at);
});

test('archiving an already-archived row is a no-op, not a re-stamp', async () => {
  const { calls, messages } = clientOf();
  await messages.archive(SCOPE, 'm1');

  assert.equal((calls[0]!.args.filters as Record<string, string>).archived_at, 'is.null');
});

test('a blank id is refused before it reaches an unfiltered write', async () => {
  const { messages } = clientOf();
  await assert.rejects(() => messages.release(SCOPE, '  ', true), TypeError);
  await assert.rejects(() => messages.archive(SCOPE, '  '), TypeError);
});

test('a blank project id lists nothing rather than everything', async () => {
  const { calls, messages } = clientOf();
  assert.deepEqual(await messages.listForProject(SCOPE, '   '), []);
  assert.equal(calls.length, 0, 'no query should have been issued at all');
});
