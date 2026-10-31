'use strict';
function planLink(id) {
  const value = String(id || '');
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(value)) return '/workflow.html';
  return '/workflow.html?plan=' + encodeURIComponent(value);
}
function requestedPlanId(search) {
  const value = new URLSearchParams(String(search || '')).get('plan') || '';
  return /^[A-Za-z0-9_-]{8,80}$/.test(value) ? value : '';
}
window.planLink = planLink;
window.requestedPlanId = requestedPlanId;
if (typeof module !== 'undefined') module.exports = { planLink, requestedPlanId };
