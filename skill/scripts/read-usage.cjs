#!/usr/bin/env node
// read-usage: print the numbers the usage-limits skill needs, in one short block.
//   node read-usage.cjs            human-readable
//   node read-usage.cjs --json     machine-readable
// Reads <config dir>/usage-latest.json (account limits) and, when CLAUDE_CODE_SESSION_ID is set,
// <config dir>/usage-sessions/<id>.json (this session's context window).
// <config dir> is $CLAUDE_CONFIG_DIR, else ~/.claude. Times are shown in the machine's local time zone.
// Never guesses: a missing or stale file is reported as such.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');

const STALE_MIN = 15; // the status line only refreshes while some session is mid-turn
const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}
function ageMin(at) {
  const t = Date.parse(at);
  return Number.isFinite(t) ? Math.round((Date.now() - t) / 60000) : null;
}
function local(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function limit(block) {
  if (!block || typeof block.used_percentage !== 'number') return null;
  return { used_percentage: block.used_percentage, resets_at: block.resets_at || null,
    resets_at_local: block.resets_at ? local(block.resets_at) : null };
}

function collect() {
  const out = { config_dir: configDir, account: null, context: null, notes: [] };
  const acc = readJson(path.join(configDir, 'usage-latest.json'));
  if (!acc) {
    out.notes.push('no usage-latest.json: the status line is not installed on this machine, or no turn has run yet. Do not guess numbers.');
  } else {
    const age = ageMin(acc.at);
    const rl = acc.rate_limits || {};
    out.account = { at: acc.at, age_minutes: age, stale: age == null || age > STALE_MIN,
      five_hour: limit(rl.five_hour), seven_day: limit(rl.seven_day) };
    if (!out.account.five_hour) out.notes.push('no 5-hour block: normal right after a reset, and some plans have no 5-hour limit. Pace on the weekly limit and context.');
    if (out.account.stale) out.notes.push('account numbers are ' + (age == null ? 'of unknown age' : age + ' min old') + ': the file refreshes only while a session is mid-turn.');
  }
  const id = process.env.CLAUDE_CODE_SESSION_ID;
  if (id && /^[A-Za-z0-9_-]+$/.test(id)) {
    const s = readJson(path.join(configDir, 'usage-sessions', id + '.json'));
    if (s && s.context_window) {
      out.context = { at: s.at, age_minutes: ageMin(s.at), used_percentage: s.context_window.used_percentage,
        window_size: s.context_window.context_window_size || null };
    } else out.notes.push('no context file for this session yet: it appears after the status line redraws. Judge by the length of the conversation.');
    const c = readJson(path.join(configDir, 'usage-sessions', id + '.compactions.json'));
    out.compactions = c ? c.count : 0;
  } else {
    out.notes.push('CLAUDE_CODE_SESSION_ID is not set: cannot read this session\'s context file.');
  }
  return out;
}

const r = collect();
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(r, null, 2));
} else {
  const lines = [];
  if (r.account) {
    const f = r.account.five_hour, w = r.account.seven_day;
    lines.push('5-hour: ' + (f ? f.used_percentage + '% used, resets ' + f.resets_at_local : 'none reported'));
    lines.push('weekly: ' + (w ? w.used_percentage + '% used, resets ' + w.resets_at_local : 'none reported'));
    lines.push('account numbers written ' + r.account.age_minutes + ' min ago' + (r.account.stale ? ' (STALE)' : ''));
  }
  if (r.context) lines.push('context: ' + r.context.used_percentage + '% of the window; compactions so far: ' + (r.compactions || 0));
  for (const n of r.notes) lines.push('note: ' + n);
  console.log(lines.join('\n'));
}
