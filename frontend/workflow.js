'use strict';

(() => {
  const API = '/api/workflow/plans';
  const $ = (id) => document.getElementById(id);
  const state = { plan: null, busy: false, history: [] };
  const kinds = { bid: '调整出价', pause: '暂停投放', negative: '添加否定词', harvest: '收割关键词' };
  const statuses = { pending: '待审核', approved: '已批准', rejected: '已拒绝', draft: '草稿', executed: '已记录执行', reviewed: '已复盘' };
  const priorities = { high: '高', medium: '中', low: '低' };
  const valueText = (value) => {
    if (value === null || value === undefined || value === '') return '—';
    return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  };
  const node = (tag, text, className) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = valueText(text);
    if (className) el.className = className;
    return el;
  };
  const number = (value) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
    ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(Number(value));
  const money = (value) => `${number(value)} ${valueText(state.plan?.context?.currency)}`;
  const dateText = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN');
  };
  function notice(message, type = 'success') {
    $('notice').textContent = message;
    $('notice').dataset.type = type;
    $('notice').hidden = !message;
  }
  function actions() { return Array.isArray(state.plan?.actions) ? state.plan.actions : []; }
  function blockers(action) { return Array.isArray(action.blocking_reasons) ? action.blocking_reasons : []; }
  function eligible(action) { return action.status === 'approved' && action.exportable === true && blockers(action).length === 0; }
  function approvedActions() { return actions().filter((action) => action.status === 'approved'); }
  function exportReady() {
    const approved = approvedActions();
    return approved.length > 0 && approved.every(eligible);
  }
  function syncDisabled() {
    document.querySelectorAll('button').forEach((button) => { button.disabled = state.busy; });
    document.querySelectorAll('form fieldset').forEach((fieldset) => { fieldset.disabled = state.busy; });
    $('reload-plan').disabled = state.busy || !state.plan;
    $('export-plan').disabled = state.busy || !exportReady();
    $('execution-form').querySelector('fieldset').disabled = state.busy || !state.plan;
    $('review-form').querySelector('fieldset').disabled = state.busy || !state.plan?.execution;
    document.querySelector('main').setAttribute('aria-busy', String(state.busy));
  }
  function errorDetails(data) {
    if (typeof data === 'string') return data;
    if (Array.isArray(data)) return data.map(errorDetails).join('\n');
    if (!data || typeof data !== 'object') return valueText(data);
    if (data.msg) return `${Array.isArray(data.loc) ? data.loc.join('.') + '：' : ''}${data.msg}`;
    return Object.entries(data).map(([key, value]) => `${key}：${errorDetails(value)}`).join('\n');
  }
  async function responseError(response) {
    const text = await response.text();
    let details = text;
    try { details = errorDetails(JSON.parse(text)); } catch { /* 保留服务端纯文本错误。 */ }
    return new Error(`请求失败（HTTP ${response.status}）${details ? '\n' + details : '，服务端未返回具体原因。'}`);
  }
  async function request(url, options = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!response.ok) throw await responseError(response);
      if (options.download) return await response.blob();
      try { return await response.json(); } catch { throw new Error('服务端返回的内容不是有效 JSON，请检查接口响应。'); }
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('请求超时。请重新获取历史方案，确认服务器是否已保存，再决定是否重试。');
      if (error instanceof TypeError) throw new Error('网络连接失败，请检查服务是否启动及网络连接。若刚提交操作，请重新获取方案确认保存状态。');
      throw error;
    } finally { window.clearTimeout(timeout); }
  }
  async function task(message, work, exportTask = false) {
    if (state.busy) return;
    state.busy = true;
    $('export-error').hidden = true;
    $('export-error').textContent = '';
    syncDisabled();
    notice(message, 'loading');
    try { await work(); }
    catch (error) {
      const messageText = error.message || String(error);
      notice(messageText, 'error');
      if (exportTask) {
        $('export-error').textContent = messageText;
        $('export-error').hidden = false;
      }
    } finally { state.busy = false; syncDisabled(); }
  }
  function validPlan(plan) {
    if (!plan || typeof plan !== 'object' || !plan.id) throw new Error('接口返回的方案缺少 id，无法继续操作。');
    return plan;
  }
  function planUrl(suffix = '') { return `${API}/${encodeURIComponent(state.plan.id)}${suffix}`; }
  function setPlan(plan) {
    state.plan = validPlan(plan);
    $('export-error').hidden = true;
    $('export-error').textContent = '';
    renderPlan();
    const summary = { id: plan.id, created_at: plan.created_at, context: plan.context, status: plan.status };
    state.history = [summary, ...state.history.filter((item) => item.id !== plan.id)];
    renderHistory();
  }
  function renderHistory() {
    const list = $('history-list');
    list.replaceChildren();
    if (!state.history.length) { list.append(node('p', '还没有方案，先导入一份报告。', 'muted')); return; }
    state.history.forEach((summary) => {
      const button = node('button', undefined, 'history-item');
      button.type = 'button';
      button.setAttribute('aria-current', String(state.plan?.id === summary.id));
      button.append(node('strong', summary.context?.asin || summary.asin || summary.id));
      button.append(node('small', `${summary.context?.account || summary.account || '账户未提供'} · ${summary.context?.marketplace || summary.marketplace || '站点未提供'}`));
      button.append(node('small', `${dateText(summary.created_at)} · ${statuses[summary.status] || summary.status || '方案'}`));
      button.addEventListener('click', () => task('正在加载历史方案…', async () => {
        setPlan(await request(`${API}/${encodeURIComponent(summary.id)}`));
        notice('历史方案已加载。');
      }));
      list.append(button);
    });
  }
  async function loadHistory() {
    const result = await request(API);
    const list = Array.isArray(result) ? result : result?.plans;
    if (!Array.isArray(list)) throw new Error('历史方案接口格式错误，应返回数组或 {plans: []}。');
    state.history = list.filter((item) => item && item.id);
    renderHistory();
  }
  function addDetail(list, label, value) { list.append(node('dt', label), node('dd', value)); }
  function renderReports() {
    const root = $('report-facts');
    root.replaceChildren();
    const reports = state.plan.reports;
    if (!reports) return;
    const box = node('div', undefined, 'report-facts');
    box.append(node('strong', '三份报表分开计算，推广商品和广告位不计入上方搜索词花费'));
    const evidence = state.plan.evidence;
    if (evidence) {
      const period = evidence.baseline_period;
      box.append(node('p', period ? `搜索词周期 ${period.start} 至 ${period.end}` : '搜索词报告没有完整日期，不能确定周期。'));
      box.append(node('p', `${evidence.combination_rule}。未并入方案的花费 ${money(evidence.companion_spend_excluded)}。`));
    }
    const grid = node('div', undefined, 'metrics');
    [['搜索词', reports.search_terms], ['推广商品', reports.advertised_products], ['广告位', reports.placements]].forEach(([label, report]) => {
      const tile = node('div', undefined, 'metric');
      tile.append(node('span', label));
      tile.append(node('strong', report ? money(report.metrics?.spend) : '未上传'));
      tile.append(node('small', report ? `归因窗口 ${valueText(report.attribution_window)}` : '不影响本次动作花费'));
      grid.append(tile);
    });
    box.append(grid);
    const groups = reports.advertised_products?.ad_groups || [];
    if (groups.length) {
      const list = node('ul');
      groups.forEach((group) => list.append(node('li', `${group.campaign} / ${group.ad_group}：${(group.asins || []).join('、')} · ${group.allocatable ? '可分配到当前商品' : '不能分配到当前商品'}`)));
      box.append(list);
    }
    root.append(box);
  }
  function renderActions() {
    const root = $('actions');
    root.replaceChildren();
    const all = actions();
    $('action-count').textContent = `${all.length} 项 · 已批准 ${all.filter((a) => a.status === 'approved').length} 项`;
    if (!all.length) root.append(node('p', '本次没有生成动作。请查看警告与报告数据。', 'muted'));
    all.forEach((action) => {
      const card = node('article', undefined, 'action-card');
      const top = node('div', undefined, 'action-top');
      const heading = node('div');
      heading.append(node('h3', `${kinds[action.kind] || action.kind || '优化动作'} · ${valueText(action.keyword)}`));
      heading.append(node('div', `优先级：${priorities[action.priority] || valueText(action.priority)} · ${valueText(action.campaign)} / ${valueText(action.ad_group)} · ${valueText(action.match_type)}`, 'action-meta'));
      top.append(heading, node('span', statuses[action.status] || action.status || '待审核', 'badge'));
      const details = node('dl', undefined, 'detail-grid');
      addDetail(details, '当前出价', money(action.current_bid));
      addDetail(details, action.current_bid == null ? '建议出价（缺少真实出价，不可执行）' : '建议出价（按真实出价计算）', money(action.proposed_bid));
      addDetail(details, '调整理由', action.reason);
      addDetail(details, '数据依据', action.evidence);
      card.append(top, details);
      const reasons = blockers(action);
      if (action.exportable !== true || reasons.length) {
        const blocked = node('div', undefined, 'blocking');
        blocked.append(node('p', '导出阻断原因'));
        const list = node('ul');
        (reasons.length ? reasons : ['该动作未被服务端标记为可执行，请核对实体匹配及批量报告。']).forEach((reason) => list.append(node('li', reason)));
        blocked.append(list);
        card.append(blocked);
      }
      const controls = node('div', undefined, 'action-controls');
      [['approved', '批准'], ['rejected', '拒绝'], ['pending', '恢复待审']].forEach(([status, label]) => {
        const button = node('button', label);
        button.type = 'button';
        button.setAttribute('aria-pressed', String(action.status === status));
        button.addEventListener('click', () => task('正在保存动作审核…', async () => {
          setPlan(await request(planUrl(`/actions/${encodeURIComponent(action.id)}`), {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status })
          }));
          notice(`动作状态：${statuses[status]}。`);
        }));
        controls.append(button);
      });
      card.append(controls);
      root.append(card);
    });
  }
  function renderRecord(id, title, data) {
    const root = $(id);
    root.replaceChildren();
    if (!data) { root.append(node('p', `暂无${title}。`, 'muted')); return; }
    const record = node('div', undefined, 'record');
    record.append(node('strong', title));
    if (id === 'execution-record') {
      record.append(node('p', `执行时间：${dateText(data.executed_at)}`));
      record.append(node('p', `备注：${valueText(data.notes)}`));
    } else {
      record.append(node('p', `周期：${valueText(data.period_start)} 至 ${valueText(data.period_end)}`));
      record.append(node('pre', data));
    }
    root.append(record);
  }
  function renderPlan() {
    const plan = state.plan;
    $('empty-plan').hidden = true;
    $('plan-content').hidden = false;
    $('plan-meta').textContent = `方案 ${plan.id} · ${dateText(plan.created_at)} · ${statuses[plan.status] || valueText(plan.status)}`;
    const context = $('context-summary');
    context.replaceChildren();
    [['账户', 'account'], ['站点', 'marketplace'], ['币种', 'currency'], ['ASIN', 'asin']].forEach(([label, key]) => context.append(node('span', `${label}：${valueText(plan.context?.[key])}`)));
    const metrics = $('metrics');
    metrics.replaceChildren();
    [['花费', 'spend', true], ['销售额', 'sales', true], ['订单', 'orders'], ['点击', 'clicks'], ['ACOS（%）', 'acos']].forEach(([label, key, monetary]) => {
      const tile = node('div', undefined, 'metric');
      tile.append(node('span', label), node('strong', monetary ? money(plan.metrics?.[key]) : number(plan.metrics?.[key])));
      metrics.append(tile);
    });
    const warningRoot = $('warnings');
    warningRoot.replaceChildren();
    if (Array.isArray(plan.warnings) && plan.warnings.length) {
      const box = node('div', undefined, 'warnings');
      box.append(node('strong', '请先核对以下提示'));
      const list = node('ul');
      plan.warnings.forEach((warning) => list.append(node('li', warning)));
      box.append(list); warningRoot.append(box);
    }
    renderReports();
    renderActions();
    $('budget-total').textContent = `每日建议总额：${money(plan.budget?.daily_total)}`;
    const allocations = $('budget-allocations');
    allocations.replaceChildren();
    const items = Array.isArray(plan.budget?.allocations) ? plan.budget.allocations : [];
    if (!items.length) allocations.append(node('p', '暂无分配建议。', 'muted'));
    items.forEach((item) => {
      const row = node('div', undefined, 'allocation');
      row.append(node('strong', item.campaign), node('span', money(item.daily_budget)), node('small', item.reason));
      allocations.append(row);
    });
    const approved = approvedActions();
    const blocked = approved.filter((action) => !eligible(action)).length;
    $('export-eligibility').textContent = exportReady()
      ? `可导出 ${approved.length} 项已批准且通过校验的动作。`
      : blocked
        ? `暂不能导出：${blocked} 项已批准动作仍有阻断。整份草稿会被拒绝，请改为拒绝或恢复待审，不能只导出其中合格的一部分。`
        : '暂不能导出：尚无已批准且可执行的动作。请先逐项审核。';
    renderRecord('execution-record', '执行记录', plan.execution);
    renderRecord('review-record', '周期复盘结果', plan.review);
    $('review-gate').textContent = plan.execution ? '已记录执行，可上传执行后周期报告。' : '请先在广告后台执行并保存执行记录，再上传周期复盘报告。';
    const executionForm = $('execution-form');
    executionForm.reset();
    if (plan.execution?.executed_at) executionForm.elements.executed_at.value = String(plan.execution.executed_at).slice(0, 10);
    executionForm.elements.notes.value = plan.execution?.notes || '';
    $('review-form').reset();
    syncDisabled();
  }
  function checkFile(file, extensions, label, required = true) {
    if (!file || !file.size) {
      if (required) throw new Error(`请选择非空的${label}。`);
      if (file?.name) throw new Error(`${label}为空文件，请重新选择。`);
      return;
    }
    if (!extensions.some((ext) => file.name.toLowerCase().endsWith(ext))) throw new Error(`${label}仅支持 ${extensions.join(' / ')} 文件。`);
  }
  function renderTrace(lines) {
    const list = $('demo-trace');
    list.replaceChildren();
    (lines || []).forEach((line) => list.append(node('li', line)));
  }
  $('load-demo').addEventListener('click', () => task('正在调用示例报表…', async () => {
    renderTrace(['1. 浏览器调用 POST /api/workflow/demo']);
    const plan = await request('/api/workflow/demo', { method: 'POST' });
    renderTrace(plan.demo_trace || []);
    setPlan(plan);
    notice('示例方案已显示。没有 Bulk 时，动作只供查看，不能导出。');
  }));
  $('import-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    task('正在分析报告并生成方案…', async () => {
      for (const key of ['account', 'marketplace', 'currency', 'asin']) {
        const value = String(data.get(key) || '').trim();
        if (!value) throw new Error('账户、站点、币种与 ASIN 均须填写，不能只有空格。');
        data.set(key, value);
      }
      checkFile(data.get('search_terms'), ['.csv'], '搜索词报告');
      checkFile(data.get('bulk'), ['.csv', '.tsv'], '批量广告报告', false);
      checkFile(data.get('advertised_products'), ['.csv'], '推广商品报告', false);
      checkFile(data.get('placements'), ['.csv'], '广告位报告', false);
      if (!data.get('bulk')?.name) data.delete('bulk');
      if (!data.get('advertised_products')?.name) data.delete('advertised_products');
      if (!data.get('placements')?.name) data.delete('placements');
      setPlan(await request(API, { method: 'POST', body: data }));
      notice('方案已生成。请查看警告、估算出价与阻断原因，再逐项审核。');
    });
  });
  $('refresh-history').addEventListener('click', () => task('正在刷新历史方案…', async () => { await loadHistory(); notice('历史方案已刷新。'); }));
  $('reload-plan').addEventListener('click', () => task('正在重新获取方案…', async () => { setPlan(await request(planUrl())); notice('方案已更新。'); }));
  $('export-plan').addEventListener('click', () => task('正在生成 TSV 草稿…', async () => {
    if (!exportReady()) throw new Error($('export-eligibility').textContent);
    const blob = await request(planUrl('/export'), { method: 'POST', download: true });
    if (/json/i.test(blob.type)) {
      let details = await blob.text();
      try { details = errorDetails(JSON.parse(details)); } catch { /* 保留错误文字。 */ }
      throw new Error(`导出失败：${details}`);
    }
    const url = URL.createObjectURL(blob);
    const link = node('a');
    link.href = url;
    link.download = `workflow-${String(state.plan.id).replace(/[^a-zA-Z0-9_-]/g, '_')}-approved.tsv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice('草稿下载已发起。请先核对实际站点模板，再到广告后台人工上传与执行。');
  }, true));
  $('execution-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    task('正在保存执行记录…', async () => {
      const executedAt = form.elements.executed_at.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(executedAt)) throw new Error('请填写有效执行日期。');
      setPlan(await request(planUrl('/execution'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ executed_at: executedAt, notes: form.elements.notes.value.trim() }) }));
      notice('执行记录已保存，可以上传执行后的周期报告进行复盘。');
    });
  });
  $('review-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    task('正在分析执行后的周期报告…', async () => {
      if (!state.plan?.execution) throw new Error('请先记录实际执行，再进行复盘。');
      checkFile(data.get('search_terms'), ['.csv'], '复盘搜索词报告');
      if (!data.get('period_start') || !data.get('period_end') || data.get('period_start') > data.get('period_end')) throw new Error('请填写有效复盘周期，开始日期不能晚于结束日期。');
      setPlan(await request(planUrl('/review'), { method: 'POST', body: data }));
      notice('周期复盘已生成，请结合周期长短、预算和其他影响因素评估变化。');
    });
  });
  task('正在加载历史方案…', async () => { await loadHistory(); notice(''); });
})();
