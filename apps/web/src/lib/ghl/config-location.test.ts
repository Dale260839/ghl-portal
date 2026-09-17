import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isGhlLocationId, readLocationTokens, withLocation, withLocationToken, type GhlConfig } from './config.ts';

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

const AFC = 'IifYfP2B2NUaoDPdsTTa';
const APS = 'IyKL37e3QdiFBx5ESI2d';
const tokens = { GHL_LOCATION_TOKENS: `${APS}:pit-aps` } as unknown as NodeJS.ProcessEnv;

test('a sub-account with its own token gets that token, because a PIT only opens its own sub-account', () => {
  const afcDefault = { ...base, token: 'pit-afc', locationId: AFC };
  const located = withLocationToken(afcDefault, APS, tokens);
  assert.equal(located.locationId, APS);
  assert.equal(located.token, 'pit-aps');
});

test('the default token is untouched for its own sub-account and any sub-account without an entry', () => {
  const afcDefault = { ...base, token: 'pit-afc', locationId: AFC };
  assert.equal(withLocationToken(afcDefault, AFC, tokens).token, 'pit-afc');
  assert.equal(withLocationToken(afcDefault, 'q3vaasvRgM2Om2t4FqZ5', tokens).token, 'pit-afc');
  assert.equal(withLocationToken(afcDefault, null, tokens).token, 'pit-afc');
  assert.equal(withLocationToken(afcDefault, APS, {} as NodeJS.ProcessEnv).token, 'pit-afc');
});

test('location tokens parse comma or newline separated, and skip entries that are not real GHL ids', () => {
  const parsed = readLocationTokens({
    GHL_LOCATION_TOKENS: ` ${APS}:pit-aps ,\nq3vaasvRgM2Om2t4FqZ5:pit-other,loc_alliance_pro:pit-bad,${AFC}:, nocolon`,
  } as unknown as NodeJS.ProcessEnv);
  assert.deepEqual([...parsed], [[APS, 'pit-aps'], ['q3vaasvRgM2Om2t4FqZ5', 'pit-other']]);
});
