'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the shipped SPA, substituting only browser/transport boundaries.
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
// app.js relies on the shared brandHit helper loaded separately in the browser.
const brandSource = fs.readFileSync(path.join(__dirname, '..', 'brand-check.js'), 'utf8');
const evidenceSource = fs.readFileSync(path.join(__dirname, '..', 'keyword-evidence.js'), 'utf8');
const readingSource = fs.readFileSync(path.join(__dirname, '..', 'reading.js'), 'utf8');
function app() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', style: {}, listeners: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener(name, fn) { this.listeners[name] = fn; } });
    return nodes.get(id);
  };
  node('#aiBrands').value = 'omoton, samsung, google, nexus';
  const context = vm.createContext({
    document: { querySelector: node, querySelectorAll: () => [] },
    window: { addEventListener() {} }, localStorage: { getItem: () => null },
    FileReader: class { readAsText(file) { this.result = file.text; this.onload(); } },
    fetch: async () => { throw new Error('Unexpected network access'); },
  });
  vm.runInContext(brandSource + '\n' + evidenceSource + '\n' + readingSource + '\n' + source + '\nrenderAI = () => {}; renderAll = () => {}; switchTab = () => {}; window.testApi = { mergeAiJson, runAiOnline, importExpertJson, newWordRows, aiNegativeExportRows, budgetReferenceRows, stSplitByCamp, mtSplitRows, kwSplitByCamp };', context);
  const state = context.window.__app.state;
  state.result = { actions: [{ mt: 'exact', kw: 'existing' }], roots: [{ type: '亏损', tok: 'loss' }], st: [
    { st: 'good', cls: '优秀', sales: 10 }, { st: 'waste', cls: '无效' },
  ] };
  state.ai = { expansions: [{ word: 'old' }], intents: [], negatives: [], insights: [], done: true };
  return { ...context.window.testApi, state, node, context };
}
const response = (content, finish_reason = 'stop', reasoning_content = '{"expansions":[{"word":"reasoning"}]}') => ({ choices: [{ finish_reason, message: { content, reasoning_content } }] });
async function online(a, data) {
  a.context.fetch = async (url, options) => {
    assert.equal(url, '/api/ai/chat');
    assert.equal(options.method, 'POST');
    return { ok: true, json: async () => data };
  };
  await a.runAiOnline();
}

for (const [name, text] of [
  ['bare JSON', '{"expansions":[{"word":"final"}]}'],
  ['JSON fence', '```json\n{"expansions":[{"word":"final"}]}\n```'],
  ['explanatory text', '建议如下：\n{"expansions":[{"word":"final"}]}\n请复核。'],
]) test(name + ' uses final only and imports identically', async () => {
  const a = app();
  await online(a, response(text));
  assert.equal(a.state.ai.expansions[0].word, 'final');
  assert.equal(a.node('#aiStatus').className, 'status ok');
  a.importExpertJson({ text });
  assert.equal(a.state.ai.expansions[0].word, 'final');
});

for (const [name, data, error] of [
  ['reasoning only', response(null), /最终 content/],
  ['empty final', response('  '), /最终 content/],
  ['non-string final', response({ expansions: [] }), /最终 content/],
  ['non-JSON final with reasoning JSON', response('仍在思考'), /完整 JSON/],
  ['truncated syntax with reasoning JSON', response('{"expansions":['), /不完整/],
  ['missing choices', {}, /最终 content/],
  ['missing message', { choices: [{}] }, /最终 content/],
  ['length with valid JSON', response('{"expansions":[]}', 'length'), /已截断.*未合并.*token/],
  ['length without final', response(null, 'length'), /已截断.*未合并.*token/],
]) test(name + ' preserves previous result', async () => {
  const a = app(), before = a.state.ai, snapshot = JSON.stringify(before);
  await online(a, data);
  assert.strictEqual(a.state.ai, before);
  assert.equal(JSON.stringify(a.state.ai), snapshot);
  assert.equal(a.node('#aiStatus').className, 'status err');
  assert.match(a.node('#aiStatus').textContent, error);
});

test('prompt carries observed totals without treating them as savings', async () => {
  const a = app();
  a.state.result.kpi = { spend: 12.5, sales: 40, orders: 3, clk: 9, acos: 0.3125 };
  a.state.result.context = { marketplace: 'US', asin: 'B0SAMPLE01', currency: 'USD' };
  let sent = '';
  a.context.fetch = async (url, options) => {
    sent = options.body;
    return { ok: true, json: async () => response('{"expansions":[{"word":"final"}]}') };
  };
  await a.runAiOnline();
  assert.match(sent, /站点 US/);
  assert.match(sent, /ASIN B0SAMPLE01/);
  assert.match(sent, /花费 12\.5/);
  assert.match(sent, /ACOS 31\.25%/);
  assert.match(sent, /不是已节省金额/);
  assert.match(sent, /不得将竞品词或搜索词中的规格、材质、兼容性当成产品事实/);
  assert.match(sent, /信息不足时可以返回空数组/);
  assert.match(sent, /品牌或设备兼容性未知时不要建议否定/);
  assert.doesNotMatch(sent, /api_key|SECRET/);
  assert.equal(JSON.parse(sent).thinking, false);
});

test('missing finish reason and optional collections remain supported', async () => {
  const a = app();
  await online(a, { choices: [{ message: { content: '{"insights":[{"title":"标题"},{"detail":"详情"}]}' } }] });
  assert.equal(a.state.ai.done, true);
  assert.equal(a.state.ai.insights.length, 2);
  assert.equal(a.state.ai.expansions.length, 0);
  a.mergeAiJson({ intents: [{ intent: 'group', keywords: [] }], expansions: [], extra: true });
  assert.equal(a.state.ai.intents.length, 1);
  a.mergeAiJson({ expansions: [] });
  assert.equal(a.state.ai.expansions.length, 0);
});

const invalid = [
  null, [], 1, 'text', {}, { unknown: [] },
  ...['expansions', 'intents', 'negativeHints', 'insights'].flatMap(key =>
    [null, {}, 'bad', [null], [3]].map(value => ({ [key]: value }))),
  { expansions: [{ word: 'valid' }, { word: ' ' }] },
  { expansions: [{ word: 3 }] }, { expansions: [{ word: 'ok', type: {} }] },
  { expansions: [{ word: 'ok', reason: null }] },
  { negativeHints: [{ word: 'ok', reason: false }] },
  { negativeHints: [{ word: '\t' }] },
  { intents: [{ intent: ' ', keywords: [] }] },
  { intents: [{ intent: 'ok', keywords: 'bad' }] },
  { intents: [{ intent: 'ok', keywords: ['valid', {}] }] },
  { intents: [{ intent: 'ok', keywords: [' '] }] },
  { insights: [{}] }, { insights: [{ title: 3 }] },
  { insights: [{ title: ' ', detail: '\t' }] }, { insights: [{ title: 'ok', detail: [] }] },
];
invalid.forEach((data, i) => test('invalid structure #' + (i + 1) + ' is rejected atomically', () => {
  const a = app(), before = a.state.ai, snapshot = JSON.stringify(before);
  assert.throws(() => a.mergeAiJson(data), /必须|至少/);
  assert.strictEqual(a.state.ai, before);
  assert.equal(JSON.stringify(a.state.ai), snapshot);
}));

test('later invalid collection cannot partly replace earlier expansions through either entry', async () => {
  const a = app(), before = a.state.ai;
  const text = JSON.stringify({ expansions: [{ word: 'new' }], intents: [], negativeHints: [], insights: [{ detail: 7 }] });
  await online(a, response(text));
  assert.strictEqual(a.state.ai, before);
  assert.match(a.node('#aiStatus').textContent, /insights\[0\]\.detail/);
  a.importExpertJson({ text });
  assert.strictEqual(a.state.ai, before);
  assert.match(a.node('#aiStatus').textContent, /导入失败.*insights\[0\]\.detail/);
});

test('complete array JSON is not salvaged into a nested result', async () => {
  const a = app(), before = a.state.ai;
  const text = '[{"expansions":[{"word":"nested"}]}]';
  await online(a, response(text));
  assert.strictEqual(a.state.ai, before);
  a.importExpertJson({ text });
  assert.strictEqual(a.state.ai, before);
});

for (const text of ['```json\n[{"expansions":[]}]\n```', '```json\n{"expansions":[]\n```']) {
  test('fenced invalid root or syntax is rejected: ' + text, async () => {
    const a = app(), before = a.state.ai;
    await online(a, response(text));
    assert.strictEqual(a.state.ai, before);
    a.importExpertJson({ text });
    assert.strictEqual(a.state.ai, before);
    assert.equal(a.node('#aiStatus').className, 'status err');
  });
}

test('good-term conflicts override waste and loss evidence before AI export', () => {
  const a = app();
  a.state.result.st.push({ st: 'cell phone', cls: '无效' }, { st: 'cell phone stand', cls: '优秀' });
  a.state.result.roots.push({ tok: 'cell phone', type: '亏损' });
  a.mergeAiJson({ expansions: [], negativeHints: [{ word: 'cell phone' }], intents: [], insights: [] });
  assert.match(a.state.ai.negatives[0].cross, /不建议否定/);
  assert.equal(a.aiNegativeExportRows([], a.state.ai.negatives).length, 0);
});

test('a competitor brand negative stays a candidate unless it covers a good term', () => {
  const a = app();
  a.state.result.st.push({ st: 'cell phone stand', cls: '优秀', sales: 20 });
  a.mergeAiJson({ expansions: [], negativeHints: [{ word: 'samsung galaxy' }, { word: 'cell phone' }, { word: 'desk lamp' }], intents: [], insights: [] });
  assert.match(a.state.ai.negatives[0].cross, /竞品品牌/);
  assert.match(a.state.ai.negatives[1].cross, /冲突/);
  assert.match(a.state.ai.negatives[2].cross, /人工复核/);
});

test('brand and covered expansions stay out of the new-word list', () => {
  const a = app();
  a.state.result.harvest = [];
  a.state.result.combos = [];
  a.state.result.st.push({ st: 'cell phone stand', cls: '优秀', sales: 20 });
  a.mergeAiJson({ expansions: [{ word: 'phone stand for samsung' }, { word: 'cell phone' }, { word: 'desk trip' }], negativeHints: [], intents: [], insights: [] });
  assert.equal(JSON.stringify(a.newWordRows().map((row) => row.word)), '["desk trip"]');
  assert.match(a.node('#aiStatus').textContent, /1 个进入新词清单/);
  assert.match(a.node('#aiStatus').textContent, /2 个未进入/);
  assert.match(a.node('#aiStatus').textContent, /竞品品牌 1/);
  assert.match(a.node('#aiStatus').textContent, /已被更长优质词包含 1/);
  assert.doesNotMatch(a.node('#aiStatus').textContent, /已并入/);
});

test('browser negative export follows the same rule and brand guards', () => {
  const a = app();
  const st = [
    { st: 'google nexus case', camp: 'CampN', adg: 'GN', orders: 2 },
    { st: 'desk lamp led', camp: 'CampD', adg: 'GD', orders: 4 },
  ];
  const rows = a.aiNegativeExportRows(
    [{ word: 'samsung galaxy' }],
    [{ word: 'Samsung   Galaxy', cross: '竞品品牌，可作为否定候选', reason: 'brand' },
     { word: 'cell phone', cross: '不建议否定', reason: 'bad' },
     { word: 'google nexus', cross: '竞品品牌，可作为否定候选', reason: 'brand' },
     { word: 'desk lamp', cross: '仅 AI 建议，需人工复核', reason: 'maybe' }],
    st,
  );
  assert.equal(JSON.stringify(rows.map((row) => row[1])), '["google nexus","desk lamp"]');
  assert.equal(rows[0][0], '待复核勿上传');
  assert.equal(rows[1][0], '待复核勿上传');
  assert.equal(rows[0][2], 'CampN', 'root-matched campaign suggestion');
  assert.equal(rows[1][2], 'CampD');
  assert.match(rows[1][8], /按词根匹配/);
});

test('the same new keyword from harvest combo and AI is listed once', () => {
  const a = app();
  a.state.result.harvest = [
    { st: 'fresh term', sug: '新增精准词', camp: 'c', adg: 'g', srcMt: 'broad', sales: 2, orders: 1, acos: 0.2, exists: false },
  ];
  a.state.result.combos = [{ pair: 'Fresh   Term', sales: 9, orders: 2, evidence: 'combo' }];
  a.state.ai = { expansions: [{ word: 'fresh term', reason: 'again' }], intents: [], negatives: [], insights: [], done: true };
  const rows = a.newWordRows();
  assert.equal(JSON.stringify(rows.map((row) => row.word)), '["fresh term"]');
  assert.equal(String(rows[0].src), '搜索词收割');
});

test('harvest that already exists is not listed as a new keyword', () => {
  const a = app();
  a.state.result.harvest = [
    { st: 'already', sug: '已有精准词：核对出价与预算', camp: 'c', adg: 'g', srcMt: 'broad', sales: 1, orders: 1, acos: 0.2, exists: true },
    { st: 'fresh term', sug: '新增精准词', camp: 'c', adg: 'g', srcMt: 'broad', sales: 2, orders: 1, acos: 0.2, exists: false },
  ];
  a.state.result.combos = [];
  a.state.ai.expansions = [];
  assert.equal(JSON.stringify(a.newWordRows().map((row) => row.word)), '["fresh term"]');
});

test('an expansion that already exists as an exact keyword stays out of the new-word list', () => {
  const a = app();
  a.state.result.harvest = [];
  a.state.result.combos = [];
  a.mergeAiJson({ expansions: [{ word: 'existing' }, { word: 'desk trip' }], negativeHints: [], intents: [], insights: [] });
  assert.equal(a.state.ai.expansions[0].exists, true);
  assert.equal(JSON.stringify(a.newWordRows().map((row) => row.word)), '["desk trip"]');
});

test('changing brand configuration clears previously merged AI rows', () => {
  const a = app();
  a.state.result.harvest = []; a.state.result.combos = [];
  a.mergeAiJson({ expansions: [{ word: 'desk holder' }], negativeHints: [{ word: 'unrelated' }], intents: [], insights: [] });
  a.node('#aiBrands').value = 'new brand';
  a.node('#aiBrands').listeners.input();
  assert.equal(a.state.ai.done, false);
  assert.equal(a.newWordRows().length, 0);
  assert.equal(a.aiNegativeExportRows([], a.state.ai.negatives).length, 0);
  assert.match(a.node('#aiStatus').textContent, /重新导入/);
});

test('empty configured brand list does not classify compatible device names', () => {
  const a = app();
  a.node('#aiBrands').value = '';
  a.mergeAiJson({ expansions: [{ word: 'phone stand for samsung galaxy' }], negativeHints: [], intents: [], insights: [] });
  assert.equal(a.state.ai.expansions[0].competitorBrand, false);
});

test('brand detection does not treat an embedded letter sequence as a brand', () => {
  const a = app();
  a.mergeAiJson({ expansions: [{ word: 'googley eyes phone stand' }, { word: 'phone stand for samsung galaxy' }], negativeHints: [], intents: [], insights: [] });
  assert.equal(a.state.ai.expansions[0].competitorBrand, false);
  assert.equal(a.state.ai.expansions[1].competitorBrand, true);
});

test('charIssues follows the official letters-numbers-spaces whitelist', () => {
  const a = app();
  const check = a.context.window.charIssues;
  const clean = a.context.window.cleanWord;
  assert.equal(JSON.stringify(check('cell phone stand')), '[]');
  assert.equal(JSON.stringify(check('wireless charger 中文')), '["含非英文字符","含官方外字符"]');
  assert.equal(JSON.stringify(check('phone "stand"')), '["含官方外字符"]');
  assert.equal(JSON.stringify(check('  pad  ')), '["含多余空格"]');
  assert.equal(JSON.stringify(check("men's shirt")), '["含官方外字符"]', 'apostrophe is outside the official whitelist');
  assert.equal(JSON.stringify(check('t-shirt for kids')), '["含官方外字符"]', 'hyphen is outside the official whitelist');
  assert.equal(JSON.stringify(check('nike® shoes')), '["含非英文字符","含官方外字符"]');
  assert.equal(clean("men's t-shirt, 100%"), 'men s t shirt 100');
  assert.equal(clean('   AT&T   router '), 'AT T router');
  assert.equal(clean('中文'), '', 'empty result signals a manual rewrite');
});

test('checkSharedDeps passes when every rule helper is present', () => {
  const a = app();
  const required = ['brandHit', 'buildReportEvidence', 'evidenceFor', 'evidenceLabel', 'adviceFor', 'sortByEvidence', 'charIssues', 'negativeCross', 'suggestPlacement'];
  assert.equal(JSON.stringify(a.context.window.checkSharedDeps(null)), '[]', 'all helpers loaded together should pass');
  delete a.context.window.charIssues;
  assert.equal(JSON.stringify(a.context.window.checkSharedDeps(null)), '["charIssues"]');
  a.context.window.charIssues = () => [];
  assert.equal(JSON.stringify(a.context.window.checkSharedDeps(null)), '[]');
});

test('kw split shows how many campaigns each bid keyword runs in', () => {
  const a = app();
  const rows = a.kwSplitByCamp([
    { st: 'x', kw: 'red shoe', camp: 'A', adg: 'G1', clk: 5, spend: 10, sales: 30, orders: 1 },
    { st: 'y', kw: 'red shoe', camp: 'B', adg: 'G2', clk: 3, spend: 8, sales: 0, orders: 0 },
    { st: 'z', kw: 'blue mat', camp: 'A', adg: 'G9', clk: 2, spend: 4, sales: 20, orders: 1 },
  ]);
  assert.equal(rows.length, 2);
  const red = rows.find((r) => r.kw === 'red shoe');
  assert.equal(red.campCount, 2, 'runs in two campaigns');
  assert.equal(red.adgCount, 2);
  assert.equal(red.spend, 18);
  assert.equal(red.acos, 0.6);
  const blue = rows.find((r) => r.kw === 'blue mat');
  assert.equal(blue.campCount, 1);
});

test('mt split aggregates spend by match type ordered by spend', () => {
  const a = app();
  const rows = a.mtSplitRows([
    { st: 'b1', mt: 'broad', clk: 10, spend: 50, sales: 40, orders: 1 },
    { st: 'e1', mt: 'exact', clk: 20, spend: 80, sales: 200, orders: 8 },
    { st: 'e2', mt: 'exact', clk: 5, spend: 20, sales: 100, orders: 4 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].mt, 'exact', 'higher spend first');
  assert.equal(rows[0].spend, 100);
  assert.equal(rows[0].orders, 12);
  assert.equal(rows[0].acos, 1 / 3);
  assert.equal(rows[1].mt, 'broad');
  assert.equal(rows[1].acos, 1.25);
});

test('st split aggregates terms per campaign group ordered by spend', () => {
  const a = app();
  const split = a.stSplitByCamp([
    { st: 'red shoe', camp: 'B', adg: 'G2', clk: 5, spend: 40, sales: 0, orders: 0 },
    { st: 'blue shoe', camp: 'A', adg: 'G1', clk: 8, spend: 20, sales: 60, orders: 2 },
    { st: 'red sandal', camp: 'B', adg: 'G2', clk: 3, spend: 10, sales: 30, orders: 1 },
  ]);
  assert.equal(split.length, 2);
  assert.equal(split[0].camp, 'B', 'higher spend first');
  assert.equal(split[0].termCount, 2);
  assert.equal(split[0].spend, 50);
  assert.equal(split[1].termCount, 1);
  assert.equal(split[1].orders, 2);
});

test('dedupKeywords flags exact/phrase/broad conflicts and returns the clean set', () => {
  const a = app();
  const dedup = a.context.window.dedupKeywords;
  const r = dedup(
    ['cell phone stand', 'phone holder', 'desk mount'],
    ['cell phone stand', 'stand for cell phone', 'cell phone', 'laptop stand'],
  );
  const byPlanned = Object.fromEntries(r.conflicts.map((c) => [c.planned, c]));
  assert.equal(byPlanned['cell phone stand'].level, 'exact');
  assert.equal(byPlanned['stand for cell phone'].level, 'broad', 'bag-of-words, order irrelevant');
  assert.equal(byPlanned['cell phone'].level, 'phrase', 'contained term is a phrase conflict');
  assert.equal(JSON.stringify(r.clean), '["laptop stand"]');
  // Priority: a planned term equal to an existing one reports exact even if phrase also fits.
  const r2 = dedup(['girl bag'], ['girl bag']);
  assert.equal(r2.conflicts[0].level, 'exact');
  // Empty and duplicate inputs are normalised.
  const r3 = dedup([], ['', 'laptop stand', 'laptop stand']);
  assert.equal(JSON.stringify(r3.conflicts), '[]');
  assert.equal(JSON.stringify(r3.clean), '["laptop stand"]');
});

test('mtReading reports spend share and above-average ACOS drift', () => {
  const a = app();
  const read = a.context.window.mtReading;
  const rows = [
    { mt: 'exact', spend: 100, sales: 300, orders: 10 },
    { mt: 'broad', spend: 50, sales: 40, orders: 1 },
  ];
  const text = read(rows);
  assert.match(text, /精准匹配占花费 66\.7%/);
  assert.match(text, /广泛匹配占花费 33\.3%.*高于整体均值/);
  assert.match(text, /整体 ACOS 44\.1%/);
  assert.match(text, /不构成调整承诺/);
  assert.equal(read([]), null);
  assert.equal(read([{ mt: 'exact', spend: 0 }]), null, 'zero spend cannot be read');
});

test('placementReading describes each band without causal claims', () => {
  const a = app();
  const read = a.context.window.placementReading;
  const rows = [
    { placement: 'Top of Search', clicks: 10, spend: 20, sales: 40, orders: 2 },
    { placement: 'Rest of Search', clicks: 20, spend: 40, sales: 0, orders: 0 },
    { placement: 'Product Pages', clicks: 5, spend: 5, sales: 10, orders: 1 },
  ];
  const text = read(rows);
  assert.match(text, /搜索顶部.*2 单/);
  assert.match(text, /其余搜索位置.*止损优先核查区/);
  assert.match(text, /商品页面.*单独评估/);
  assert.match(text, /不构成因果判断/);
  assert.equal(read([]), null);
});

test('budget reference derives coverage days from the report dates', () => {
  const a = app();
  const rows = a.budgetReferenceRows([], [
    { st: 'a', camp: 'C1', adg: 'G1', spend: 90, sales: 120, orders: 5, clk: 25, date: '2026-01-01' },
    { st: 'b', camp: 'C1', adg: 'G1', spend: 30, sales: 60, orders: 1, clk: 10, date: '2026-01-08' },
    { st: 'c', camp: 'C2', adg: 'G9', spend: 10, sales: 0, orders: 0, clk: 5, date: '2026-01-01' },
  ]);
  assert.equal(rows[0].days, 8);
  assert.equal(rows[0].daily, 15);
  assert.equal(rows[1].days, 8);
});

test('budget reference shows unknown days when the report has no dates', () => {
  const a = app();
  const rows = a.budgetReferenceRows([], [
    { st: 'a', camp: 'C1', adg: 'G1', spend: 90, sales: 120, orders: 5, clk: 25 },
  ]);
  assert.equal(rows[0].days, null);
  assert.equal(rows[0].daily, null);
});

test('budget reference aggregates spend per campaign group without advice', () => {
  const a = app();
  const rows = a.budgetReferenceRows([], [
    { st: 'a', camp: 'C1', adg: 'G1', spend: 30, sales: 90, orders: 3, clk: 10 },
    { st: 'b', camp: 'C1', adg: 'G1', spend: 60, sales: 120, orders: 2, clk: 15 },
    { st: 'c', camp: 'C2', adg: 'G9', spend: 10, sales: 0, orders: 0, clk: 5 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(JSON.stringify(rows[0].camp), '"C1"');
  assert.equal(rows[0].spend, 90);
  assert.equal(rows[0].daily, null, 'no dates in fixture -> unknown pace');
  assert.equal(rows[0].orders, 5);
  assert.equal(rows[1].spend, 10);
});

test('suggestPlacement matches the ordered report row sharing a word root', () => {
  const a = app();
  const suggest = a.context.window.suggestPlacement;
  const st = [
    { st: 'desk trip organizer', camp: 'CampB', adg: 'G2', orders: 5 },
    { st: 'desk trip mat', camp: 'CampA', adg: 'G1', orders: 2 },
    { st: 'desk trip pad', camp: 'CampC', adg: 'G3', orders: 0 },
  ];
  assert.equal(JSON.stringify(suggest('desk trip', st)), JSON.stringify({ camp: 'CampB', adg: 'G2', via: '按词根匹配 CampB / G2，需人工确认' }));
  assert.equal(suggest('unrelated term', st).camp, '');
  assert.equal(suggest('desk', []).camp, '');
  assert.equal(suggest('ab', st).camp, '', 'too-short words never match');
});

test('advice label maps evidence to an actionable suggestion', () => {
  const a = app();
  const advice = a.context.window.adviceFor;
  assert.equal(advice(2, 3), '优先新增');
  assert.equal(advice(1, 0), '先观察');
  assert.equal(advice(0, 0), '待验证');
  assert.equal(advice(null, null), '待验证');
});

test('evidence sorting puts the best supported suggestions first and stays stable', () => {
  const a = app();
  const sort = a.context.window.sortByEvidence;
  const list = [
    { word: 'no evidence' },
    { word: 'one row' , reportRows: 1, reportOrders: 0 },
    { word: 'ordered', reportRows: 2, reportOrders: 3 },
    { word: 'also one row', reportRows: 1, reportOrders: 0 },
  ];
  const sorted = sort(list);
  assert.equal(JSON.stringify(sorted.map((x) => x.word)), '["ordered","one row","also one row","no evidence"]');
  assert.equal(list[0].word, 'no evidence', 'original list must not be mutated');
});

test('expansions carry evidence counts from our own report', () => {
  const a = app();
  a.state.result.harvest = []; a.state.result.combos = [];
  a.state.result.st.push(
    { st: 'desk trip', cls: '优秀', sales: 40, orders: 2 },
    { st: 'desk trip', cls: '良好', sales: 20, orders: 1 },
  );
  a.mergeAiJson({ expansions: [{ word: 'desk trip' }, { word: 'unseen word' }], negativeHints: [], intents: [], insights: [] });
  assert.equal(a.state.ai.expansions[0].reportRows, 2);
  assert.equal(a.state.ai.expansions[0].reportOrders, 3);
  assert.equal(a.state.ai.expansions[1].reportRows, 0);
  assert.equal(a.state.ai.expansions[1].reportOrders, 0);
});

test('a good search term that is also a substring stays an independent candidate', () => {
  const a = app();
  a.state.result.harvest = []; a.state.result.combos = [];
  a.state.result.st.push(
    { st: 'cell phone stand', cls: '优秀', sales: 20 },
    { st: 'cell phone', cls: '优秀', sales: 15 },
  );
  a.mergeAiJson({ expansions: [{ word: 'cell phone' }, { word: 'phone' }, { word: 'desk trip' }], negativeHints: [], intents: [], insights: [] });
  assert.equal(a.state.ai.expansions[0].coveredByGood, false);
  assert.equal(a.state.ai.expansions[1].coveredByGood, true);
  assert.equal(a.state.ai.expansions[2].coveredByGood, false);
  const words = a.newWordRows().filter((row) => row.src === 'AI扩词').map((row) => row.word);
  assert.equal(JSON.stringify(words), '["cell phone","desk trip"]');
});

test('an expansion with a competitor brand is flagged', () => {
  const a = app();
  a.mergeAiJson({ expansions: [{ word: 'phone stand for samsung galaxy tab' }, { word: 'foldable phone stand for desk' }], negativeHints: [], intents: [], insights: [] });
  assert.equal(a.state.ai.expansions[0].competitorBrand, true);
  assert.equal(a.state.ai.expansions[1].competitorBrand, false);
});

test('an expansion inside a longer good term is already covered', () => {
  const a = app();
  a.state.result.st.push({ st: 'cell phone stand', cls: '优秀', sales: 20 });
  a.mergeAiJson({ expansions: [{ word: 'cell phone' }, { word: 'desk trip' }], negativeHints: [], intents: [], insights: [] });
  assert.equal(a.state.ai.expansions[0].coveredByGood, true);
  assert.equal(a.state.ai.expansions[0].exists, false);
  assert.equal(a.state.ai.expansions[1].coveredByGood, false);
});

test('a negative inside a good term is a conflict', () => {
  const a = app();
  a.state.result.st.push({ st: 'cell phone stand', cls: '优秀', sales: 20 });
  a.mergeAiJson({ expansions: [], negativeHints: [{ word: 'cell phone' }, { word: 'a' }], intents: [], insights: [] });
  assert.match(a.state.ai.negatives[0].cross, /冲突/);
  assert.match(a.state.ai.negatives[1].cross, /人工复核/);
});

test('successful merge preserves duplicate and rule cross-check behavior', () => {
  const a = app();
  a.mergeAiJson({ expansions: [{ word: ' existing ', type: '', reason: '' }],
    negativeHints: ['waste', 'loss', 'good', 'unknown'].map(word => ({ word })),
    intents: [{ intent: 'purchase', keywords: ['good'] }], insights: [{ detail: 'review' }] });
  assert.equal(a.state.ai.expansions[0].exists, true);
  assert.equal(a.state.ai.expansions[0].word, 'existing');
  assert.equal(a.state.ai.expansions[0].type, 'AI');
  assert.match(a.state.ai.negatives[0].cross, /高置信/);
  assert.match(a.state.ai.negatives[1].cross, /高置信/);
  assert.match(a.state.ai.negatives[2].cross, /冲突/);
  assert.match(a.state.ai.negatives[3].cross, /人工复核/);
  assert.equal(a.state.ai.done, true);
});
