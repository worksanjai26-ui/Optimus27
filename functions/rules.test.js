'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PASSES, slotKey, profileError, memberStatus } = require('./rules');

const people = new Map([
  ['OPT27-00001', { name: 'ANAND KUMAR' }],
  ['OPT27-00002', { name: 'BHAVANA R' }]
]);
const lookup = (id) => people.get(id) || null;

test('profile fields are validated', () => {
  assert.equal(profileError({ name: 'JOSEPH VIJAY', phone: '+91 98765 43210', college: 'KPR Institute' }), null);
  assert.match(profileError({ name: 'Joseph Vijay', phone: '9876543210', college: 'KPR' }), /CAPITAL/);
  assert.match(profileError({ name: 'JOSEPH', phone: 'abc', college: 'KPR' }), /phone/);
  assert.match(profileError({ name: 'JOSEPH', phone: '9876543210', college: '' }), /college/);
});

test('teammate check: ok, wrong format, duplicate, unknown', () => {
  assert.equal(memberStatus({ id: 'OPT27-00001', name: 'ANAND KUMAR' }, ['OPT27-00009'], lookup), 'ok');
  assert.equal(memberStatus({ id: 'opt27-00001', name: ' ANAND   KUMAR ' }, [], lookup), 'ok', 'case and spacing are forgiven');
  assert.equal(memberStatus({ id: '123', name: 'ANAND KUMAR' }, [], lookup), 'bad-format');
  assert.equal(memberStatus({ id: 'OPT27-00001', name: 'ANAND KUMAR' }, ['OPT27-00001'], lookup), 'duplicate');
  // A wrong name and a missing ID look identical, so IDs cannot be probed.
  assert.equal(memberStatus({ id: 'OPT27-00001', name: 'SOMEONE ELSE' }, [], lookup), 'not-found');
  assert.equal(memberStatus({ id: 'OPT27-99999', name: 'ANAND KUMAR' }, [], lookup), 'not-found');
});

test('one place per person per event', () => {
  assert.equal(slotKey('hackathon', null, 'OPT27-00001'), 'hackathon_OPT27-00001');
  assert.notEqual(slotKey('oneday', 0, 'OPT27-00001'), slotKey('oneday', 1, 'OPT27-00001'), 'one-day pass: one per day');
});

test('pass rules match the website', () => {
  assert.deepEqual(PASSES.hackathon.team, { min: 2, max: 4 });
  assert.equal(PASSES.hackathon.price, 500);
  assert.equal(PASSES.oneday.pickDay, true);
});
