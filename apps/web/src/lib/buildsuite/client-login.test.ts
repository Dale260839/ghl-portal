import assert from 'node:assert/strict';
import test from 'node:test';

import { BuildSuiteClient } from './client.ts';
import { SupabaseReader, type ContractorLookup } from './projects.ts';

/**
 * The BuildSuite half of the homeowner's code sign-in.
 *
 * `client-credentials.test.ts` covers the policy — the limit, the
 * indistinguishable failure, what gets written. This covers the QUERY: that
 * both halves are compared inside the database, that an unsigned contract
 * finds nothing, and that a client's email address never leaves BuildSuite.
 *
 * Every case here was run against live data on 2026-09-10 as well; the
 * contractor fallback exists because that run found `BSA-APS-001` — a genuinely
 * signed project whose homeowner could not sign in.
 */

interface Call {
  url: string;
  method: string;
}

/**
 * A reader whose fetch is scripted. Responses are consumed in order and the
 * last one repeats, so a test states only the rows it cares about.
 */
function readerOf(responses: unknown[], lookup?: ContractorLookup) {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET' });
    return new Response(JSON.stringify(responses[Math.min(i++, responses.length - 1)]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  const client = new BuildSuiteClient({ url: 'https://bs.example', key: 'k' }, { fetchImpl });
  return {
    calls,
    reader: new SupabaseReader(client, lookup ?? (async () => ({ resolved: false, reason: 'unlinked' }))),
  };
}

const PROJECT = {
  id: 'p-1',
  ghl_contact_id: 'ghl-1',
  client_name: 'Zander Garcia',
  auth_profile_id: 'ap-1',
};
const SIGNED_PROPOSAL = { contractor_id: 'c-1' };

// ── The match ────────────────────────────────────────────────────────────────

test('both halves are compared inside the database', async () => {
  // Not fetched and filtered here. A match done in this process would mean
  // pulling candidate rows out of BuildSuite to compare them, and the rows are
  // homeowners' addresses.
  const { reader, calls } = readerOf([[PROJECT], [SIGNED_PROPOSAL]]);
  await reader.findSignedProjectForClient('BSA-052', 'owner@example.com');

  const projectQuery = calls[0]!.url;
  assert.match(projectQuery, /project_code=eq\.BSA-052/);
  assert.match(projectQuery, /client_email=eq\.owner(%40|@)example\.com/);
});

test('the client address is never selected back out', async () => {
  // D-010 minimisation. The query compares the address; it must not return it,
  // or every sign-in attempt would hand this process somebody's email whether
  // or not the caller had proved anything.
  const { reader, calls } = readerOf([[PROJECT], [SIGNED_PROPOSAL]]);
  await reader.findSignedProjectForClient('BSA-052', 'owner@example.com');

  const select = decodeURIComponent(calls[0]!.url).match(/select=([^&]*)/)![1]!;
  assert.equal(select.split(',').includes('client_email'), false, `selected: ${select}`);
});

test('a malformed code or address never reaches the database', async () => {
  // Validated, not escaped. A `,` or a `)` inside a PostgREST filter value
  // changes what the filter means, so the answer is to refuse the input rather
  // than to try to quote it.
  const { reader, calls } = readerOf([[PROJECT], [SIGNED_PROPOSAL]]);

  const nasty: [string, string][] = [
    ["BSA-052') or true--", 'owner@example.com'],
    ['BSA-052', 'owner@example.com,client_email=neq.x'],
    ['BSA-052', 'owner@example.com)'],
    ['NOTACODE', 'owner@example.com'],
    ['BSA-', 'owner@example.com'],
    ['', ''],
    ['BSA-052', 'not-an-address'],
  ];

  for (const [code, email] of nasty) {
    assert.equal(
      await reader.findSignedProjectForClient(code, email),
      null,
      `accepted ${JSON.stringify([code, email])}`,
    );
  }
  assert.deepEqual(calls, [], 'a rejected input still reached the network');
});

test('both live code shapes are accepted', async () => {
  // `BSA-044` from the feed and `BSA-APS-001` created by a contractor. A
  // three-digits-only pattern rejected every contractor-created project, whose
  // homeowner could then never sign in at all.
  for (const code of ['BSA-052', 'BSA-APS-001', 'bsa-052']) {
    const { reader } = readerOf([[PROJECT], [SIGNED_PROPOSAL]]);
    assert.notEqual(
      await reader.findSignedProjectForClient(code, 'owner@example.com'),
      null,
      `rejected ${code}`,
    );
  }
});

test('two projects sharing a code sign nobody in', async () => {
  // A data fault. Picking one of them would sign somebody into a job that may
  // not be theirs, which is worse than refusing.
  const { reader } = readerOf([[PROJECT, { ...PROJECT, id: 'p-2' }], [SIGNED_PROPOSAL]]);
  assert.equal(await reader.findSignedProjectForClient('BSA-052', 'owner@example.com'), null);
});

// ── The signature gate ───────────────────────────────────────────────────────

test('the proposal query demands a signature, a timestamp and no deletion', async () => {
  const { reader, calls } = readerOf([[PROJECT], [SIGNED_PROPOSAL]]);
  await reader.findSignedProjectForClient('BSA-052', 'owner@example.com');

  const proposalQuery = decodeURIComponent(calls[1]!.url);
  assert.match(proposalQuery, /project_id=eq\.p-1/);
  assert.match(proposalQuery, /signature_status=eq\.SIGNED/);
  // Both, so a half-written row — a status set by an automation that never
  // recorded a time, or the reverse — does not open a portal.
  assert.match(proposalQuery, /signature_signed_at=not\.is\.null/);
  assert.match(proposalQuery, /deleted_at=is\.null/);
});

test('an unsigned project admits nobody', async () => {
  // The lookup RESOLVES here, deliberately. With the default refusing lookup
  // this test passed even with the signature check removed — the contractor
  // simply came back empty and refused for the wrong reason. Caught on
  // 2026-09-10 by deleting the check and watching this stay green.
  //
  // Now the signature gate is the only thing standing between this call and a
  // signed-in homeowner, which is what the test claims to be about.
  const { reader } = readerOf([[PROJECT], []], async () => ({
    resolved: true,
    identity: { contractorId: 'c-would-have-worked' },
  }));
  assert.equal(await reader.findSignedProjectForClient('BSA-044', 'owner@example.com'), null);
});

test('a project that does not match the email admits nobody', async () => {
  const { reader } = readerOf([[], [SIGNED_PROPOSAL]]);
  assert.equal(await reader.findSignedProjectForClient('BSA-052', 'stranger@example.com'), null);
});

// ── Whose contractor ─────────────────────────────────────────────────────────

test('the contractor comes off the signed proposal when it names one', async () => {
  const { reader } = readerOf([[PROJECT], [SIGNED_PROPOSAL]], async () => {
    throw new Error('the fallback must not run when the proposal names a contractor');
  });

  const found = await reader.findSignedProjectForClient('BSA-052', 'owner@example.com');
  assert.deepEqual(found, {
    projectId: 'p-1',
    contractorId: 'c-1',
    ghlContactId: 'ghl-1',
    clientName: 'Zander Garcia',
  });
});

test('a signed proposal with no contractor falls back to the project owner', async () => {
  // 13 of 48 proposals carry no `contractor_id`, and one of the six SIGNED ones
  // does not — `BSA-APS-001`. Without this, a homeowner holding a correct code
  // for a genuinely signed contract is refused. Found by running the real
  // reader against live data, not by reading the schema.
  const seen: string[] = [];
  const { reader } = readerOf([[PROJECT], [{ contractor_id: null }]], async (scope) => {
    seen.push(...scope.authProfileIds);
    return { resolved: true, identity: { contractorId: 'c-from-profile' } };
  });

  const found = await reader.findSignedProjectForClient('BSA-APS-001', 'owner@example.com');
  assert.equal(found?.contractorId, 'c-from-profile');
  assert.deepEqual(seen, ['ap-1'], 'it must resolve from the PROJECT owner profile');
});

test('the fallback never runs for an unsigned project', async () => {
  // Order matters. Resolving a contractor first and checking the signature
  // afterwards would make the gate a formality that a refactor could drop.
  let ran = false;
  const { reader } = readerOf([[PROJECT], []], async () => {
    ran = true;
    return { resolved: true, identity: { contractorId: 'c-x' } };
  });

  assert.equal(await reader.findSignedProjectForClient('BSA-044', 'owner@example.com'), null);
  assert.equal(ran, false, 'an unsigned project must be refused before anything is resolved');
});

test('a contract that names no contractor by any link admits nobody', async () => {
  // The membership this would open is filed under a contractor id. Filing it
  // under an empty string puts a homeowner in a tenant that does not exist.
  const { reader } = readerOf([[PROJECT], [{ contractor_id: null }]], async () => ({
    resolved: false,
    reason: 'unlinked',
  }));
  assert.equal(await reader.findSignedProjectForClient('BSA-052', 'owner@example.com'), null);
});

test('a project with no owner profile does not even try to resolve', async () => {
  let ran = false;
  const { reader } = readerOf(
    [[{ ...PROJECT, auth_profile_id: null }], [{ contractor_id: null }]],
    async () => {
      ran = true;
      return { resolved: true, identity: { contractorId: 'c-x' } };
    },
  );

  assert.equal(await reader.findSignedProjectForClient('BSA-052', 'owner@example.com'), null);
  assert.equal(ran, false);
});
