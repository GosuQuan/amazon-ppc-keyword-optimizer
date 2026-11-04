'use strict';
/* One-shot health check: git sync, app, parity, and the full test suites.
   Usage: node tools/health_check.js  (exit 0 = all green) */
const { execSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
let failures = 0;
const step = (name, fn) => {
  try {
    const result = fn();
    console.log('OK   ' + name + (result ? '  ' + String(result).trim().split('\n').pop() : ''));
    return result;
  } catch (e) {
    failures++;
    console.error('FAIL ' + name + '  ' + String(e.message).split('\n')[0]);
    return null;
  }
};

console.log('== health check @ ' + new Date().toISOString() + ' ==');

step('git worktree clean-ish', () => {
  const s = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' });
  if (s.trim()) return s.trim().split('\n').length + ' uncommitted files';
  return 'clean';
});
step('branch synced with origin', () => {
  const s = execSync('git status -sb', { cwd: root, encoding: 'utf8' }).split('\n')[0];
  if (s.includes('ahead')) throw new Error(s.trim());
  if (s.includes('behind')) throw new Error(s.trim());
  return s.trim();
});
step('local app responds', () => {
  execSync('node -e "fetch(\'http://127.0.0.1:8790/\').then(r=>{if(!r.ok)throw new Error(r.status);process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)})"', { cwd: root, stdio: 'inherit' });
  return '200';
});
step('frontend suite', () => {
  const out = execSync('node --test frontend/tests/ai-output.test.cjs frontend/tests/import-check.test.cjs frontend/tests/import-help.test.cjs frontend/tests/reading.test.cjs frontend/tests/conclusion.test.cjs frontend/tests/point-cost.test.cjs frontend/tests/usage.test.cjs', { cwd: root, encoding: 'utf8' });
  const m = out.match(/^. tests (\d+)/m) && out.match(/^. pass (\d+)/m);
  return m ? m[1] + ' passed' : 'done';
});
step('backend suite', () => {
  const env = { ...process.env, PYTHONPATH: path.join(root, '.deps') + ';' + path.join(root, 'backend'), PYTHONIOENCODING: 'utf-8' };
  const out = execSync('"C:\\Users\\admin\\AppData\\Local\\Programs\\Python\\Python311\\python.exe" -m pytest -q backend/tests', { cwd: root, encoding: 'utf8', env });
  const m = out.match(/(\d+) passed/);
  return m ? m[1] + ' passed' : 'done';
});
step('two-front-end parity', () => {
  const out = execSync('node tools/ui_parity.js', { cwd: root, encoding: 'utf8' });
  const m = out.match(/（(\d+) 张）/);
  return m ? m[1] + ' tables aligned' : 'aligned';
});
step('react smoke (CDP)', () => {
  const env = { ...process.env, CDP_PORT: process.env.CDP_PORT || '9333', SMOKE_BASE: 'http://127.0.0.1:8790', SMOKE_APP: 'http://127.0.0.1:8790/' };
  execSync('node tools/react_smoke.js', { cwd: root, stdio: 'inherit', env });
  return 'all pass';
});

console.log(failures ? '\n' + failures + ' check(s) FAILED' : '\nall green');
process.exit(failures ? 1 : 0);
