'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../conclusion.js'), 'utf8');
function load() {
  const context = vm.createContext({ window: {}, module: { exports: {} } });
  vm.runInContext(source, context);
  return context.window;
}

test('empty action list says no candidates yet', () => {
  const { actionConclusion, conclusionText } = load();
  const text = conclusionText(actionConclusion([]));
  assert.match(text, /还没有生成候选动作/);
  assert.doesNotMatch(text, /共 0 个/);
});

test('counts by kind, blockers and exportable', () => {
  const { actionConclusion } = load();
  const c = actionConclusion([
    { kind: 'bid', exportable: true, status: 'pending' },
    { kind: 'bid', exportable: true, status: 'approved' },
    { kind: 'pause', exportable: false, blocking_reasons: ['缺 Bulk'], status: 'pending' },
    { kind: 'negative', exportable: true, status: 'pending' },
  ]);
  assert.equal(c.total, 4);
  assert.equal(c.byKind.bid, 2);
  assert.equal(c.blocked, 1);
  assert.equal(c.exportable, 3);
  assert.equal(c.approved, 1);
});

test('top blocking reasons are named in the conclusion', () => {
  const { actionConclusion, conclusionText } = load();
  const c = actionConclusion([
    { kind: 'bid', exportable: false, blocking_reasons: ['缺少真实出价'], status: 'pending' },
    { kind: 'bid', exportable: false, blocking_reasons: ['缺少真实出价'], status: 'pending' },
    { kind: 'pause', exportable: false, blocking_reasons: ['没有确定广告组'], status: 'pending' },
  ]);
  assert.equal(JSON.stringify(c.reasons[0]), JSON.stringify({ text: '缺少真实出价', count: 2 }));
  const text = conclusionText(c);
  assert.match(text, /缺少真实出价 2 项/);
  assert.match(text, /没有确定广告组 1 项/);
});

test('blocked actions are the first thing to review', () => {
  const { actionConclusion, conclusionText } = load();
  const text = conclusionText(actionConclusion([
    { kind: 'bid', exportable: false, blocking_reasons: ['缺 Bulk'], status: 'pending' },
  ]));
  assert.match(text, /先核对那 1 个被阻断的动作/);
});

test('guidance moves to approval when nothing is blocked', () => {
  const { actionConclusion, conclusionText } = load();
  const text = conclusionText(actionConclusion([
    { kind: 'bid', exportable: true, status: 'pending' },
  ]));
  assert.match(text, /逐项审核后再批准/);
  assert.doesNotMatch(text, /先核对/);
});

test('summary never claims savings or ad effect', () => {
  const { actionConclusion, conclusionText } = load();
  const text = conclusionText(actionConclusion([
    { kind: 'harvest', exportable: true, status: 'approved' },
  ]));
  assert.match(text, /不构成已节省金额/);
  assert.match(text, /不等于广告效果/);
  assert.doesNotMatch(text, /已节省 \d|节省 \d|节省费用|提升 \d|ROAS \d/);
});
