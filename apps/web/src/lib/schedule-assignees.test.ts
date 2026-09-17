import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appointmentRecipients,
  appointmentTimeLabel,
  appointmentWhen,
  assigneeChoices,
  currentAssignee,
  EARLIER_KEY,
  portalSafeTrade,
  resolveAssignee,
  shouldNotify,
  type CrewCandidate,
} from './schedule-assignees.ts';

/**
 * Tagging an appointment with the homeowner or a crew member, and who is
 * emailed (John, 2026-09-17).
 */

const CREW: CrewCandidate[] = [
  { id: 'm-tony', email: 'tony@crew.example', fullName: 'Tony Alvarez', role: 'field', revoked: false },
  { id: 'm-dale', email: 'dale@alliance4contractors.com', fullName: '', role: 'field', revoked: false },
  { id: 'm-gone', email: 'gone@crew.example', fullName: 'Gone Person', role: 'field', revoked: true },
  { id: 'm-home', email: 'owner@example.com', fullName: 'Dana Johnson', role: 'client', revoked: false },
];

const choices = () => assigneeChoices({ clientName: 'Dana Johnson', crew: CREW });

test('the list is the homeowner and the active field crew — nobody revoked, no client twice', () => {
  const c = choices();
  assert.equal(c.homeowner.label, 'Homeowner — Dana Johnson');
  assert.deepEqual(
    c.crew.map((m) => m.key),
    ['crew:m-dale', 'crew:m-tony'],
    'revoked crew and the homeowner membership are not crew options',
  );
  // A crew member with no name is still listed, by address.
  assert.equal(c.crew.find((m) => m.key === 'crew:m-dale')?.label, 'dale@alliance4contractors.com');
});

test('a project with no client name still offers the homeowner', () => {
  const c = assigneeChoices({ clientName: '  ', crew: [] });
  assert.equal(c.homeowner.label, 'Homeowner');
  assert.deepEqual(c.crew, []);
});

test('an existing appointment shows who it is tagged with', () => {
  const c = choices();
  assert.deepEqual(currentAssignee(c, ''), { key: '', earlier: null });
  assert.equal(currentAssignee(c, 'Homeowner — Dana Johnson').key, 'homeowner');
  assert.equal(currentAssignee(c, 'tony alvarez').key, 'crew:m-tony');
});

test('a value typed before the dropdown is kept, not wiped by the next save', () => {
  const c = choices();
  const shown = currentAssignee(c, 'Electrician');
  assert.equal(shown.key, EARLIER_KEY);
  assert.equal(shown.earlier?.label, 'Electrician');
  assert.deepEqual(resolveAssignee(c, EARLIER_KEY), { kind: 'keep' });
});

test('only what was offered can be posted — anything else is refused', () => {
  const c = choices();
  assert.deepEqual(resolveAssignee(c, ''), { kind: 'none' });
  assert.equal(resolveAssignee(c, 'homeowner').kind, 'person');
  assert.equal(resolveAssignee(c, 'crew:m-tony').kind, 'person');
  // Revoked, another tenant's member, or a made-up key.
  for (const key of ['crew:m-gone', 'crew:someone-else', 'crew:m-home', 'email:attacker@example.com']) {
    assert.deepEqual(resolveAssignee(c, key), { kind: 'unknown' }, key);
  }
});

test('a new tag emails; saving the same tag again does not', () => {
  const c = choices();
  const tony = resolveAssignee(c, 'crew:m-tony');
  assert.equal(shouldNotify(null, tony), true, 'a new appointment with someone tagged');
  assert.equal(shouldNotify('', tony), true, 'tagged for the first time on an edit');
  assert.equal(shouldNotify('Homeowner — Dana Johnson', tony), true, 'the tag changed');
  assert.equal(shouldNotify('Tony Alvarez', tony), false, 'a title fix must not email the crew again');
  assert.equal(shouldNotify(null, resolveAssignee(c, '')), false, 'nobody tagged, nobody emailed');
  assert.equal(shouldNotify('Electrician', resolveAssignee(c, EARLIER_KEY)), false);
});

test('the contractor and the tagged person each get one email', () => {
  const c = choices();
  const tony = c.crew.find((m) => m.key === 'crew:m-tony')!;
  assert.deepEqual(
    appointmentRecipients({
      contractor: { email: 'Office@APS.example ', name: 'APS' },
      assignee: tony,
      assigneeEmail: 'tony@crew.example',
    }),
    [
      { email: 'office@aps.example', name: 'APS', audience: 'contractor' },
      { email: 'tony@crew.example', name: 'Tony Alvarez', audience: 'crew' },
    ],
  );

  // The homeowner is addressed by name, as a homeowner.
  const home = appointmentRecipients({
    contractor: { email: 'office@aps.example', name: 'APS' },
    assignee: c.homeowner,
    assigneeEmail: 'owner@example.com',
  });
  assert.deepEqual(home[1], { email: 'owner@example.com', name: 'Dana Johnson', audience: 'homeowner' });
});

test('the same address twice is one email, and no address is no email', () => {
  const c = choices();
  const dale = c.crew.find((m) => m.key === 'crew:m-dale')!;
  assert.equal(
    appointmentRecipients({
      contractor: { email: 'dale@alliance4contractors.com', name: 'APS' },
      assignee: dale,
      assigneeEmail: 'DALE@alliance4contractors.com',
    }).length,
    1,
  );
  assert.deepEqual(
    appointmentRecipients({ contractor: { email: null, name: 'APS' }, assignee: c.homeowner, assigneeEmail: '' }),
    [],
  );
});

test('a homeowner never reads a crew member’s email address', () => {
  assert.equal(portalSafeTrade('dale@alliance4contractors.com'), 'Field crew');
  assert.equal(portalSafeTrade('Tony Alvarez'), 'Tony Alvarez');
  assert.equal(portalSafeTrade('Homeowner — Dana Johnson'), 'Homeowner — Dana Johnson');
  assert.equal(portalSafeTrade(''), '');
});

test('the date in the email is the one typed, in any server time zone', () => {
  assert.equal(appointmentTimeLabel('2026-09-22T09:00'), 'Tue, Sep 22, 2026, 9:00 AM');
  // A stored value comes back with a zone; the wall-clock digits are what count.
  assert.equal(appointmentTimeLabel('2026-09-22T09:00:00+00:00'), 'Tue, Sep 22, 2026, 9:00 AM');
  assert.equal(appointmentTimeLabel(null), null);
  assert.equal(appointmentTimeLabel('not a date'), null);

  assert.equal(appointmentWhen('2026-09-22T09:00', '2026-09-22T11:30'), 'Tue, Sep 22, 2026, 9:00 AM – 11:30 AM');
  assert.equal(
    appointmentWhen('2026-09-22T09:00', '2026-09-23T17:00'),
    'Tue, Sep 22, 2026, 9:00 AM – Wed, Sep 23, 2026, 5:00 PM',
  );
  assert.equal(appointmentWhen(null, '2026-09-23T17:00'), null);
});
