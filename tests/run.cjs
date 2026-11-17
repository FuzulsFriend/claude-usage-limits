// Self-test for the three scripts. Needs only node.   node tests/run.cjs
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');

const scripts = path.join(__dirname, '..', 'skill', 'scripts');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-test-'));
let pass = 0, fail = 0;
const ok = (c, name) => { if (c) pass++; else { fail++; console.log('FAIL: ' + name); } };
const run = (script, stdin, env) => spawnSync(process.execPath, [path.join(scripts, script)],
  { input: stdin, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: dir, ...env } });

try {
  const resets = Math.floor(Date.now() / 1000) + 3600;
  const sl = {
    model: { display_name: 'Test Model' },
    session_id: 'sess_abc-123',
    rate_limits: { five_hour: { used_percentage: 96.4, resets_at: resets }, seven_day: { used_percentage: 62, resets_at: resets + 86400 } },
    context_window: { used_percentage: 55.2, context_window_size: 200000 },
    cost: { total_cost_usd: 1.234 }
  };

  // status line: output and both snapshot files
  const a = run('statusline.cjs', JSON.stringify(sl));
  ok(a.stdout === '[Test Model]  !! PAUSE 5h:96%  7d:62%  ctx:55%  $1.23', 'status line text: ' + a.stdout);
  const latest = JSON.parse(fs.readFileSync(path.join(dir, 'usage-latest.json'), 'utf8'));
  ok(latest.rate_limits.seven_day.used_percentage === 62 && latest.at, 'usage-latest.json written');
  const sess = JSON.parse(fs.readFileSync(path.join(dir, 'usage-sessions', 'sess_abc-123.json'), 'utf8'));
  ok(sess.context_window.used_percentage === 55.2, 'per-session file written');
  ok(run('statusline.cjs', 'not json').stdout === 'Claude Code', 'bad input does not break the status line');
  const hostile = run('statusline.cjs', JSON.stringify({ ...sl, session_id: '../../evil' }));
  ok(!fs.existsSync(path.join(dir, '..', 'evil.json')) && hostile.status === 0, 'hostile session id is ignored');

  // reader: human and json
  const r1 = run('read-usage.cjs', '', { CLAUDE_CODE_SESSION_ID: 'sess_abc-123' });
  ok(/5-hour: 96.4% used, resets \d{4}-\d\d-\d\d \d\d:\d\d/.test(r1.stdout), '5-hour line: ' + r1.stdout);
  ok(/weekly: 62% used/.test(r1.stdout) && /context: 55.2% of the window; compactions so far: 0/.test(r1.stdout), 'weekly and context lines');
  ok(!/STALE/.test(r1.stdout), 'fresh file is not stale');
  const r2 = JSON.parse(spawnSync(process.execPath, [path.join(scripts, 'read-usage.cjs'), '--json'],
    { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: dir, CLAUDE_CODE_SESSION_ID: 'sess_abc-123' } }).stdout);
  ok(r2.account.five_hour.used_percentage === 96.4 && r2.context.used_percentage === 55.2, 'json output');

  // reader: stale and missing
  latest.at = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  fs.writeFileSync(path.join(dir, 'usage-latest.json'), JSON.stringify(latest));
  ok(/STALE/.test(run('read-usage.cjs', '', {}).stdout), 'old file is flagged STALE');
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-empty-'));
  const r3 = run('read-usage.cjs', '', { CLAUDE_CONFIG_DIR: empty });
  ok(/no usage-latest.json/.test(r3.stdout) && /Do not guess/.test(r3.stdout), 'missing file is reported, not guessed');
  fs.rmSync(empty, { recursive: true, force: true });

  // compaction hook: counts, and escalates above 5
  const hook = (n) => JSON.parse(run('count-compactions.cjs', JSON.stringify({ session_id: 'sess_abc-123', source: 'compact' })).stdout);
  let out;
  for (let i = 1; i <= 5; i++) out = hook();
  ok(/compacted 5 times/.test(out.hookSpecificOutput.additionalContext) && !out.systemMessage, 'five compactions: counted, no escalation');
  out = hook();
  ok(/compacted 6 times/.test(out.hookSpecificOutput.additionalContext) && /fresh session/.test(out.systemMessage), 'sixth compaction escalates');
  ok(run('count-compactions.cjs', JSON.stringify({ session_id: 'sess_abc-123', source: 'startup' })).stdout === '', 'non-compact start is ignored');
  const counted = JSON.parse(fs.readFileSync(path.join(dir, 'usage-sessions', 'sess_abc-123.compactions.json'), 'utf8'));
  ok(counted.count === 6, 'count file says 6');
  ok(/compactions so far: 6/.test(run('read-usage.cjs', '', { CLAUDE_CODE_SESSION_ID: 'sess_abc-123' }).stdout), 'reader shows the compaction count');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('usage-limits scripts: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
