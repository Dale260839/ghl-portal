import assert from 'node:assert/strict';
import { test } from 'node:test';

import { brandCode } from './brand.ts';

test('initials of a multi-word business name', () => {
  assert.equal(brandCode('Alliance Pro Services'), 'APS');
  assert.equal(brandCode('Bexar Holdings LLC'), 'BH');
});

test('legal suffixes never become letters', () => {
  assert.equal(brandCode('Priority Electric LLC'), 'PE');
  assert.equal(brandCode('Acme Roofing, Inc.'), 'AR');
  assert.equal(brandCode('Castillo Co.'), 'CAS');
});

test('a one-word name takes its first three letters', () => {
  assert.equal(brandCode('Bexar'), 'BEX');
});

test('caps at three letters', () => {
  assert.equal(brandCode('Alliance For Contractors Group'), 'AFC');
});

test('nothing usable falls back rather than inventing', () => {
  assert.equal(brandCode(''), 'APS');
  assert.equal(brandCode(null), 'APS');
  assert.equal(brandCode('LLC'), 'APS');
  assert.equal(brandCode(undefined, 'HUB'), 'HUB');
});
