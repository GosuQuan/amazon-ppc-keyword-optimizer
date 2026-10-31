'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const value = n => typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('zh-CN') : '未知';
  const element = (tag, text) => {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = String(text);
    return item;
  };
  let loading = false;
  async function refresh() {
    if (loading) return;
    loading = true;
    $('refresh-usage').disabled = true;
    $('usage-status').textContent = '正在读取调用记录…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/ai/usage', { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data.summary || !Array.isArray(data.records)) throw new Error('账本格式无效');
      const s = data.summary;
      const cards = [
        ['已记录调用', value(s.calls)], ['接口成功 / 失败', `${value(s.successes)} / ${value(s.failures)}`],
        ['已知输入 token', `${value(s.prompt_tokens)}（覆盖 ${value(s.prompt_known_calls)} 次）`],
        ['已知输出 token', `${value(s.completion_tokens)}（覆盖 ${value(s.completion_known_calls)} 次）`],
        ['已知总 token', `${value(s.total_tokens)}（覆盖 ${value(s.usage_known_calls)} 次）`],
        ['模型费用', '未知（待核实费率及账单）'],
      ];
      $('usage-summary').replaceChildren(...cards.map(([title, detail]) => {
        const card = element('div');
        card.append(element('small', title), element('p', detail));
        return card;
      }));
      $('usage-records').replaceChildren(...data.records.map(record => {
        const row = element('p');
        row.textContent = `${record.created_at || '未知时间'} · ${record.provider || '未知服务商'} · ${record.model || '未知模型'} · ${record.success ? '接口成功' : '接口失败'} · HTTP ${record.status ?? '未收到响应'} · ${value(record.duration_ms)} ms · token ${value(record.total_tokens)} · 费用未知`;
        return row;
      }));
      $('usage-status').textContent = s.calls === 0
        ? '尚无调用记录。历史接入测试不会追溯入账；刷新本面板不会消耗模型额度。'
        : `用量已更新。${value(s.calls - s.usage_known_calls)} 次调用未返回有效总 token；账本不等同服务商结算账单。`;
    } catch (error) {
      $('usage-status').textContent = `读取失败：${error.name === 'AbortError' ? '请求超时' : error.message}。可点击刷新；已显示的数据可能不是最新。`;
    } finally {
      clearTimeout(timeout);
      loading = false;
      $('refresh-usage').disabled = false;
    }
  }
  $('refresh-usage').addEventListener('click', refresh);
  refresh();
})();
