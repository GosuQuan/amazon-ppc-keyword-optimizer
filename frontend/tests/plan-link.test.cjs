'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
global.window = {};
const { planLink, requestedPlanId } = require('../plan-link.js');

test('plan links keep only safe identifiers', () => {
  assert.equal(planLink('abc12345'), '/workflow.html?plan=abc12345');
  assert.equal(planLink('../secret'), '/workflow.html');
  assert.equal(planLink(''), '/workflow.html');
  assert.equal(requestedPlanId('?plan=abc12345'), 'abc12345');
  assert.equal(requestedPlanId('?plan=../secret'), '');
  assert.equal(requestedPlanId(''), '');
});
