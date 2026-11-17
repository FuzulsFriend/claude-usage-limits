// Claude Code status line for the usage-limits skill.
// Prints the REAL 5-hour and 7-day limit percentages, the context window percentage and the session cost,
// and writes two small files that the skill reads:
//   <config dir>/usage-latest.json            account limits (shared by every session)
//   <config dir>/usage-sessions/<id>.json     this session's context window
// <config dir> is $CLAUDE_CONFIG_DIR, else ~/.claude.
// rate_limits.* are present for subscribers after the first API response of a session.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');

const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

let raw = '';
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let j;
  try { j = JSON.parse(raw); } catch (e) { process.stdout.write('Claude Code'); return; }
  const parts = [];
  const model = j.model && j.model.display_name;
  if (model) parts.push('[' + model + ']');

  const h5 = j.rate_limits && j.rate_limits.five_hour && j.rate_limits.five_hour.used_percentage;
  const d7 = j.rate_limits && j.rate_limits.seven_day && j.rate_limits.seven_day.used_percentage;
  const ctx = j.context_window && j.context_window.used_percentage;
  const cost = j.cost && j.cost.total_cost_usd;

  // Account limits are shared by every session, so the last writer is fine.
  if (j.rate_limits) {
    try {
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'usage-latest.json'),
        JSON.stringify({ at: new Date().toISOString(), rate_limits: j.rate_limits }));
    } catch (e) { /* never break the status line */ }
  }
  // The context window is per session, so one file per session id. A session reads its own file through the
  // CLAUDE_CODE_SESSION_ID environment variable.
  if (j.session_id && j.context_window && /^[A-Za-z0-9_-]+$/.test(j.session_id)) {
    try {
      const dir = path.join(configDir, 'usage-sessions');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, j.session_id + '.json'), JSON.stringify({
        at: new Date().toISOString(), session_id: j.session_id,
        model: j.model && j.model.display_name, context_window: j.context_window }));
    } catch (e) { /* never break the status line */ }
  }

  if (h5 != null) {
    const r = Math.round(h5);
    const mark = r >= 94 ? '!! PAUSE ' : (r >= 85 ? '! ' : '');
    parts.push(mark + '5h:' + r + '%');
  } else {
    parts.push('5h:--');
  }
  if (d7 != null) parts.push('7d:' + Math.round(d7) + '%');
  if (ctx != null) parts.push('ctx:' + Math.round(ctx) + '%');
  if (cost != null) parts.push('$' + Number(cost).toFixed(2));

  process.stdout.write(parts.join('  '));
});
