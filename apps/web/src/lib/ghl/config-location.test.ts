import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isGhlLocationId, withLocation, type GhlConfig } from './config.ts';

const base: GhlConfig = {
  baseUrl: 'https://example.test',
  apiVersion: '2021-07-28',
  token: 'x',
  locationId: '',
  projectObjectKey: '',
};

test('a real GHL sub-account id is recognised; fixtures and placeholders are not', () => {
  assert.equal(isGhlLocationId('IyKL37e3QdiFBx5ESI2d'), true);
  assert.equal(isGhlLocationId('loc_alliance_pro'), false);
  assert.equal(isGhlLocationId('buildsuite:location-unknown'), false);
  assert.equal(isGhlLocationId(''), false);
  assert.equal(isGhlLocationId(null), false);
  assert.equal(isGhlLocationId(undefined), false);
});

test('the session location wins over an empty env location', () => {
  assert.equal(withLocation(base, 'IyKL37e3QdiFBx5ESI2d').locationId, 'IyKL37e3QdiFBx5ESI2d');
});

test('the session location also wins over a configured env location, so one deployment serves many contractors', () => {
  const envSet = { ...base, locationId: 'q3vaasvRgM2Om2t4FqZ5' };
  assert.equal(withLocation(envSet, 'IyKL37e3QdiFBx5ESI2d').locationId, 'IyKL37e3QdiFBx5ESI2d');
});

test('a placeholder or fixture location never reaches the API; the env value stands', () => {
  const envSet = { ...base, locationId: 'q3vaasvRgM2Om2t4FqZ5' };
  assert.equal(withLocation(envSet, 'buildsuite:location-unknown').locationId, 'q3vaasvRgM2Om2t4FqZ5');
  assert.equal(withLocation(envSet, 'loc_alliance_pro').locationId, 'q3vaasvRgM2Om2t4FqZ5');
  assert.equal(withLocation(base, 'loc_alliance_pro').locationId, '');
});
