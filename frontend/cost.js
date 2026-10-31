'use strict';
(() => {
  const form = document.getElementById('review-time-form');
  const status = document.getElementById('cost-status');
  if (!form || !status) return;
  const show = (data) => {
    status.textContent = `已记录审核 ${data.review_minutes} 分钟，共 ${data.review_count} 次。模型费用未知；广告花费变化未计为节省。`;
  };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const minutes = Number(new FormData(form).get('minutes'));
    const note = String(new FormData(form).get('note') || '').trim();
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      status.textContent = '请填写 1 到 1440 的整数分钟。';
      return;
    }
    try {
      const response = await fetch('/api/cost/review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes, note }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || '记录失败');
      show(data);
      form.reset();
    } catch (error) {
      status.textContent = `记录失败：${error.message}`;
    }
  });
})();
