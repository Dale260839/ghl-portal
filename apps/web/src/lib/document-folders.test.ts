import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALL_FOLDERS,
  CLIENT_FOLDER,
  DEFAULT_FOLDER,
  FIELD_TRADES,
  UNSORTED_LABEL,
  canBeReleased,
  clientCanSeeDocument,
  fieldFolder,
  folderLabel,
  isClientFolder,
  isFieldFolder,
  parseFolder,
} from './document-folders.ts';

test('a field folder is the trade behind a middle dot', () => {
  // The exact string matters: the crew screen, the homeowner gate and this
  // module all compare it, and a stray hyphen would split them.
  assert.equal(fieldFolder('Electrical'), 'Field · Electrical');
  assert.equal(DEFAULT_FOLDER, 'Field · General');
});

test('Client is the client folder and nothing else is', () => {
  assert.equal(isClientFolder('Client'), true);
  assert.equal(isClientFolder('  Client  '), true);
  assert.equal(isClientFolder('client'), false);
  assert.equal(isClientFolder('Client copies'), false);
  assert.equal(isClientFolder('Field · Electrical'), false);
  assert.equal(isClientFolder(null), false);
  assert.equal(isClientFolder(''), false);
});

test('a field folder needs a trade after the prefix', () => {
  assert.equal(isFieldFolder('Field · Plumbing'), true);
  assert.equal(isFieldFolder('Field · '), false);
  assert.equal(isFieldFolder('Field'), false);
  assert.equal(isFieldFolder('Fieldwork'), false);
  assert.equal(isFieldFolder('Client'), false);
  assert.equal(isFieldFolder(undefined), false);
});

test('every trade has a folder, Client leads the list, and there are no duplicates', () => {
  assert.equal(ALL_FOLDERS[0], CLIENT_FOLDER);
  assert.equal(ALL_FOLDERS.length, FIELD_TRADES.length + 1);
  assert.equal(new Set(ALL_FOLDERS).size, ALL_FOLDERS.length);
  for (const trade of FIELD_TRADES) {
    assert.ok(ALL_FOLDERS.includes(fieldFolder(trade)), `${trade} has no folder`);
    assert.equal(isFieldFolder(fieldFolder(trade)), true);
  }
});

test('a legacy category shows as Unsorted rather than disappearing', () => {
  // Rows written before folders existed carry Contract, Permit, Drawing. They
  // are unfiled, not invalid, so they still list.
  assert.equal(folderLabel('Contract'), UNSORTED_LABEL);
  assert.equal(folderLabel(''), UNSORTED_LABEL);
  assert.equal(folderLabel(null), UNSORTED_LABEL);
  assert.equal(folderLabel('Client'), 'Client');
  assert.equal(folderLabel('Field · Roofing'), 'Field · Roofing');
});

test('parseFolder names the audience and the trade', () => {
  assert.deepEqual(parseFolder('Client'), { audience: 'client' });
  assert.deepEqual(parseFolder('Field · HVAC'), { audience: 'field', trade: 'HVAC' });
  assert.deepEqual(parseFolder('Permit'), { audience: 'unsorted' });
  assert.equal(parseFolder('Field · Drywall').trade, 'Drywall');
  assert.equal(parseFolder('Client').trade, undefined);
});

test('the homeowner needs BOTH the Client folder and the release switch', () => {
  assert.equal(clientCanSeeDocument({ category: 'Client', clientVisible: true }), true);
  // The release switch is on but the file is not in the Client folder. This is
  // the leak the second gate exists to stop: a legacy released row, or one
  // moved into a trade folder after it was released.
  assert.equal(clientCanSeeDocument({ category: 'Field · Electrical', clientVisible: true }), false);
  assert.equal(clientCanSeeDocument({ category: 'Contract', clientVisible: true }), false);
  assert.equal(clientCanSeeDocument({ category: null, clientVisible: true }), false);
  // In the Client folder but not released yet.
  assert.equal(clientCanSeeDocument({ category: 'Client', clientVisible: false }), false);
});

test('a field folder document can never be released', () => {
  assert.equal(canBeReleased('Field · Painting'), false);
  assert.equal(canBeReleased('Client'), true);
  // An unsorted legacy row can still be released; releasing moves it to Client.
  assert.equal(canBeReleased('Drawing'), true);
});
