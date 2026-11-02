'use strict';
/* React version of the optimisation workbench. Reuses the shared pre-check and conclusion helpers. */
/* Shares the hooks/aliases declared by app.js; do not redeclare them here. */

function Field({ label, children, hint }) {
  return React.createElement('label', null, label, children, hint ? React.createElement('small', { className: 'muted' }, hint) : null);
}

function FileField({ label, name, accept, required, onCheck, onFile }) {
  const [text, setText] = useState('');
  const onChange = (event) => {
    const file = event.target.files && event.target.files[0];
    if (onFile) onFile(name, file || null);
    if (!file) { setText(''); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const first = String(reader.result || '').split(/\r?\n/)[0] || '';
      const message = onCheck ? onCheck(name, first) : '';
      setText(message);
    };
    reader.onerror = () => setText('无法读取所选文件，请确认文件可访问。');
    reader.readAsText(file.slice(0, 8192));
  };
  return React.createElement(
    'label',
    { className: 'file-field' },
    label,
    React.createElement('input', { type: 'file', name, accept, required, onChange }),
    text ? React.createElement('small', { className: 'muted' }, text) : null
  );
}

function WorkflowView({ token }) {
  const [form, setForm] = useState({
    account: 'acct', marketplace: 'US', currency: 'USD', asin: '', target_acos: '25', daily_budget: '50',
  });
  const [checks, setChecks] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState('');
  const [files, setFiles] = useState({});
  const [plan, setPlan] = useState(null);

  const update = (key) => (event) => setForm((prev) => Object.assign({}, prev, { [key]: event.target.value }));

  const runCheck = useCallback((name, header) => {
    if (!header) return '';
    if (name === 'search_terms') return window.headerCheckText(window.missingSearchColumns(header));
    if (name === 'bulk') return window.bulkCheckText(window.missingBulkColumns(header));
    if (name === 'advertised_products') return window.optionalReportCheckText(window.missingSimpleColumns(header, window.PRODUCTS_REQUIRED), '推广商品报告');
    if (name === 'placements') return window.optionalReportCheckText(window.missingSimpleColumns(header, window.PLACEMENTS_REQUIRED), '广告位报告');
    return '';
  }, []);

  const onSubmit = async (event) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const data = new FormData();
      Object.keys(form).forEach((key) => data.append(key, form[key]));
      if (files.search_terms) data.append('search_terms', files.search_terms);
      ['bulk', 'advertised_products', 'placements'].forEach((key) => { if (files[key]) data.append(key, files[key]); });
      const res = await fetch('/api/workflow/plans', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: data });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || JSON.stringify(body).slice(0, 200));
      setPlan(body);
    } catch (e) {
      setError(e.message || '生成失败');
    } finally { setBusy(false); }
  };

  const metrics = plan && plan.metrics ? plan.metrics : null;
  const actions = plan && Array.isArray(plan.actions) ? plan.actions : [];
  const conclusion = plan ? window.actionConclusion(actions) : null;

  const onFilePicked = useCallback((name, file) => {
    setFiles((prev) => Object.assign({}, prev, { [name]: file }));
  }, []);

  const reload = useCallback((id) => {
    return fetch('/api/workflow/plans/' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('方案重新获取失败'))));
  }, [token]);

  const setStatus = useCallback(async (actionId, status) => {
    if (!plan) return;
    setError('');
    try {
      const res = await fetch('/api/workflow/plans/' + encodeURIComponent(plan.id) + '/actions/' + encodeURIComponent(actionId), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ status }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || '审核失败');
      setPlan(await reload(plan.id));
    } catch (e) {
      setError(e.message || '审核失败');
    }
  }, [plan, token, reload]);

  const canExport = useCallback(() => {
    const readiness = plan && plan.export_readiness;
    if (readiness) return readiness.ready === true;
    const approved = (plan && plan.actions || []).filter((a) => a.status === 'approved');
    return approved.length > 0 && approved.every((a) => a.exportable && !(a.blocking_reasons || []).length);
  }, [plan]);

  const exportNote = useCallback(() => {
    const readiness = plan && plan.export_readiness;
    if (!readiness) return '尚未获取导出资格信息。';
    if (readiness.ready) return `可导出 ${readiness.approved} 项已批准且通过校验的动作。${readiness.note || ''}`;
    if (readiness.already_exported) return `已有草稿快照，模板验收状态：${readiness.template_validated ? '已验证' : '未验证'}。${readiness.note || ''}`;
    if (readiness.blocked && readiness.blocked.length) {
      return '暂不能导出：' + readiness.blocked.map((item) => `${item.keyword}：${(item.reasons || []).join('、')}`).join('；')
        + '。整份草稿会被拒绝，不能只导出其中合格的一部分。';
    }
    return '暂不能导出：尚无已批准且可执行的动作。请先逐项审核。';
  }, [plan]);

  const doExport = useCallback(async () => {
    if (!plan) return;
    setExportBusy(true); setExportError('');
    try {
      const res = await fetch('/api/workflow/plans/' + encodeURIComponent(plan.id) + '/export', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || '导出失败');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sp-draft-' + plan.id + '.tsv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setPlan(await reload(plan.id));
    } catch (e) {
      setExportError(e.message || '导出失败');
    } finally { setExportBusy(false); }
  }, [plan, token, reload]);

  return React.createElement(
    'main',
    null,
    React.createElement(
      'section',
      { className: 'panel anim-fade-up' },
      React.createElement('p', { className: 'eyebrow' }, '01 / 建立上下文'),
      React.createElement('h1', null, '导入商品广告报告'),
      React.createElement('p', { className: 'callout' },
        '本次会读取：搜索词报告的点击、花费、销售额、订单与匹配类型；批量报告仅用于补齐实体 ID 与真实出价（缺失时动作只可查看、不能导出）。生成方案消耗积分。'),
      React.createElement(
        'form',
        { onSubmit },
        React.createElement(
          'div',
          { className: 'form-grid' },
          React.createElement(Field, { label: '账户', children: React.createElement('input', { value: form.account, onChange: update('account'), required: true }) }),
          React.createElement(Field, { label: '站点', children: React.createElement('input', { value: form.marketplace, onChange: update('marketplace'), required: true }) }),
          React.createElement(Field, { label: '币种', children: React.createElement('input', { value: form.currency, onChange: update('currency'), required: true }) }),
          React.createElement(Field, { label: '商品 ASIN', children: React.createElement('input', { value: form.asin, onChange: update('asin'), placeholder: '例如：B0BVMQ2WJ1', required: true }) }),
          React.createElement(Field, { label: '目标 ACOS（%）', children: React.createElement('input', { type: 'number', value: form.target_acos, onChange: update('target_acos'), required: true }) }),
          React.createElement(Field, { label: '每日预算', children: React.createElement('input', { type: 'number', value: form.daily_budget, onChange: update('daily_budget'), placeholder: '例如：50', required: true }) }),
          React.createElement(FileField, { label: '搜索词报告 · 必填 CSV', name: 'search_terms', accept: '.csv', required: true, onCheck: runCheck, onFile: onFilePicked }),
          React.createElement(FileField, { label: '批量广告报告 · 可选 CSV / TSV', name: 'bulk', accept: '.csv,.tsv', onCheck: runCheck, onFile: onFilePicked })
        ),
        React.createElement('button', { className: 'primary', type: 'submit', disabled: busy },
          busy ? '正在分析报告…' : '生成优化方案 →', busy ? React.createElement('span', { className: 'spinner' }) : null),
        error ? React.createElement('p', { className: 'error', role: 'alert' }, error) : null
      )
    ),
    plan ? React.createElement(
      'section',
      { className: 'panel anim-fade-up stagger-2' },
      React.createElement('p', { className: 'eyebrow' }, '02 / 分析看板'),
      React.createElement('h2', null, '当前方案'),
      React.createElement('p', { className: 'muted' }, '方案 ' + plan.id + ' · ' + (plan.context && plan.context.asin)),
      React.createElement(
        'div',
        { className: 'metrics' },
        metrics ? [['花费', metrics.spend], ['销售额', metrics.sales], ['订单', metrics.orders], ['点击', metrics.clicks], ['ACOS（%）', metrics.acos]].map(([label, value]) => React.createElement(
          'div', { className: 'metric', key: label },
          React.createElement('span', null, label),
          React.createElement('strong', null, value == null ? '—' : String(value))
        )) : null
      ),
      React.createElement('p', { className: 'callout' }, window.metricsReading(metrics, plan.target_acos, plan.context && plan.context.currency)),
      React.createElement('p', { className: 'callout' }, window.conclusionText(conclusion)),
      React.createElement(
        'div',
        { className: 'action-cards' },
        actions.slice(0, 6).map((action, index) => React.createElement(
          'div', { className: 'action-card anim-fade-up stagger-' + ((index % 3) + 1), key: action.id || index },
          React.createElement('b', null, action.keyword || '优化动作'),
          React.createElement('small', null, (action.kind || '') + ' · ' + (action.status || '') + (action.exportable ? ' · 可导出' : ' · 不可导出')),
          action.blocking_reasons && action.blocking_reasons.length
            ? React.createElement('small', null, '阻断：' + action.blocking_reasons.join('、')) : null,
           React.createElement('div', { className: 'row' },
             React.createElement('button', {
               type: 'button', disabled: action.status === 'approved',
               onClick: () => setStatus(action.id, 'approved'),
             }, action.status === 'approved' ? '已批准' : '批准'),
             React.createElement('button', {
               type: 'button', disabled: action.status === 'rejected',
               onClick: () => setStatus(action.id, 'rejected'),
             }, '拒绝'))
        ))
      )
    ) : null,
    plan ? React.createElement(
      'section',
      { className: 'panel anim-fade-up stagger-3' },
      React.createElement('p', { className: 'eyebrow' }, '03 / 下载并核对'),
      React.createElement('h2', null, '导出已批准的可执行草稿'),
      React.createElement('p', { className: 'callout' }, exportNote()),
      exportError ? React.createElement('p', { className: 'error', role: 'alert' }, exportError) : null,
      React.createElement('button', {
        className: 'primary', type: 'button', disabled: exportBusy || !canExport(), onClick: doExport,
      }, exportBusy ? '正在生成草稿…' : '下载 TSV 批量草稿',
        exportBusy ? React.createElement('span', { className: 'spinner' }) : null)
    ) : null
  );
}

window.WorkflowView = WorkflowView;
