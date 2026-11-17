// SessionStart hook (matcher "compact"): counts how many times THIS session has been compacted, by the user or by
// itself, and tells the session the number (usage-limits skill, section 8). Above 5 it also tells the user directly
// and asks the session to offer a fresh session with a HANDOFF.md and a copy-paste start prompt.
// One small file per session: <config dir>/usage-sessions/<session_id>.compactions.json. Never fails the session start.
// <config dir> is $CLAUDE_CONFIG_DIR, else ~/.claude.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const LIMIT = 5;
const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
let raw = '';
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  let j = {};
  try { j = JSON.parse(raw); } catch (e) { return; }
  if (j.source && j.source !== 'compact') return;
  const id = String(j.session_id || '');
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return;
  const dir = path.join(configDir, 'usage-sessions');
  const file = path.join(dir, id + '.compactions.json');
  let n = 0;
  try { n = Number(JSON.parse(fs.readFileSync(file, 'utf8')).count) || 0; } catch (e) { /* first compaction */ }
  n += 1;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ count: n, last_at: new Date().toISOString() }));
  } catch (e) { /* never break the session start */ }
  let context = 'This session has now been compacted ' + n + (n === 1 ? ' time' : ' times')
    + ' (counted by the usage-limits compaction hook; usage-limits skill, section 8).';
  const out = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '' } };
  if (n > LIMIT) {
    context += ' That is more than ' + LIMIT + ': each compaction keeps only a summary, so detail is being lost. Tell the user plainly'
      + ' in your next message and recommend continuing in a fresh session. If they agree: write a HANDOFF.md (goal, current state,'
      + ' decisions with reasons, open items, exact next steps, the files and commands that matter, anything still running), then'
      + ' give them ONE short copy-paste start prompt in the chat that points the new session at that file. Keep working until they answer.';
    out.systemMessage = 'This session has been compacted ' + n + ' times. A fresh session would work better: ask Claude for a handoff.';
  }
  out.hookSpecificOutput.additionalContext = context;
  process.stdout.write(JSON.stringify(out));
});
