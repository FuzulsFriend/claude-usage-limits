---
name: usage-limits
description: Track Claude usage limits (the 5-hour limit where the plan has one, the weekly limit, and THIS session's context window) during any substantial or long-running work, plan phases to fit what is left, stop at a clean boundary near a limit, arm an automatic resume after a reset, tell the user when the session's context reaches 50, 60 and 70% and whether that moment is a safe point to compact, and after more than 5 compactions of one session recommend a fresh session with a HANDOFF.md and a copy-paste start prompt. Use at the start of any multi-step task, before spawning agents or workflows, between phases, and whenever a session will run unattended or through a reset. Triggers include "watch the limits", "usage", "weekly limit", "session limit", "context window", "when should I compact", "compact", "pause until reset", "resume after reset", "continue automatically".
---

# Usage limits: plan, pace, stop clean, resume on time, compact at the right moment

Every session tracks its own usage: the account limits (5-hour where the plan has one, weekly) and its own context window. The user should never have to tell you the numbers.

Paths use `<skill>` for the folder this skill lives in (for example `~/.claude/skills/usage-limits`) and `<config>` for the Claude config folder (`$CLAUDE_CONFIG_DIR`, else `~/.claude`).

## 0. One-time setup (the numbers have to come from somewhere)

Claude Code hands rate-limit and context numbers to the status line, not to the model. This skill ships a status line script that saves them to small files, and a hook that counts compactions. Without them, say so once and pace conservatively; never guess numbers. See the repo README for the exact `settings.json` snippet (`<skill>/settings.example.json`). In short:

- `statusLine` runs `node <skill>/scripts/statusline.cjs`;
- a `SessionStart` hook with matcher `compact` runs `node <skill>/scripts/count-compactions.cjs`.

## 1. Read the numbers

```bash
node <skill>/scripts/read-usage.cjs          # short human-readable block
node <skill>/scripts/read-usage.cjs --json   # the same, machine-readable
```

It reads `<config>/usage-latest.json`, written by the status line from `rate_limits.five_hour` and `rate_limits.seven_day` (`used_percentage`, `resets_at` in unix seconds), and prints reset times in the machine's local time zone.

- `at` is when the file was written. The file refreshes ONLY while some session is mid-turn. When idle it goes stale: the reader flags anything older than 15 minutes.
- A missing `five_hour` block right after a reset is normal, and some plans have no 5-hour limit at all: then pace on the weekly limit and the context window only, and skip every 5-hour rule below.
- If the file does not exist on this machine (cloud session, another PC), say so once and pace conservatively; never guess numbers.

## 2. Plan with them (before any substantial task)

- Estimate the task's cost first. If it will not fit before `resets_at`, say so and propose doing it, or its heavy phase, after the reset. Finish a clean phase boundary first.
- The user sets the weekly stop line (for example 98%, and no production change above 97%). Runs on API credits do not count against the account limits, so near the line agent work can move to credits if the user has them; that is a deliberate, logged choice.
- Multi-agent work costs several times a single chat; say so before starting one.

## 3. Run with them

- One workflow per phase (plan, build, review); re-read the numbers between phases.
- Cap concurrent strongest-model agents at about 3; use a mid-size or small model for mechanical and build work.
- During a long run, a recurring scheduled job every 15-20 minutes keeps the reading fresh (delete it when done).
- Persist plans and findings to files as you go. A dead agent (limit hit) never counts as a pass in a gate.
- **The advisor: a cheaper main model, a stronger model only at hard moments** (experimental; see Claude Code's advisor documentation). The main model calls the advisor at decision points (before choosing an approach, on a recurring error, before declaring done); the advisor reads the whole conversation and returns guidance. Advisor tokens bill at the advisor's rates and count toward the plan's usage limits, but because it runs only at decision points, "mid-size main plus strong advisor" typically costs less than the strong model throughout.
  - Use it for long multi-step work where most turns are routine: builders and fix rounds, long sessions that today run the strongest model only for the hard parts.
  - Skip it for short or mechanical work (verify runners, merges, lookups) and where every turn needs the strongest model (high-risk reviewers).
  - Turn it on per session or per run, not globally: `claude --advisor <model>` or `/advisor <model>` (also works in `-p`). `/advisor` saves `advisorModel` in user settings, and subagents inherit it, so a global setting adds advisor calls to every cheap mechanical agent. Off: `/advisor off`.
  - Pairing rule: the advisor ranks at or above the main model, and a strongest-tier main model accepts only an equal advisor, so it saves nothing there. Model names and versions change; check your Claude Code version's `/advisor` help for what pairs.
  - Each advisor call re-reads the whole transcript uncached, so on a very long session ask it to consult sparingly.

## 4. Stop clean (90-95% of the 5-hour limit)

- Let the step in hand finish, then stop. Never stop mid-way through a money, database or merge step: if the remaining budget cannot finish such a step, do not start it.
- Write a resume note (what is done, what is next, exact commands) to a handoff file before going idle.

## 5. Resume on time

- Before going idle for a reset, schedule the wake-up one minute after `resets_at` (local time), with a prompt that says exactly what to resume, and tell the user when it fires. "I'll resume after the reset" without a scheduled wake-up means nothing resumes.
- **What to schedule it with, most to least reliable:**
  1. An operating-system one-time task (Windows Task Scheduler `schtasks /SC ONCE`, macOS launchd or `at`, Linux `at` or a systemd timer) that starts a fresh Claude session with a prompt file. It does not depend on any session being alive. Test it once end to end before you rely on it, and delete the task after it runs.
  2. An in-session scheduler (Claude Code's `CronCreate`) only while the user is active: it fires only while the session is idle, lives only in that session, and can silently not fire. Set its time from `date` plus an offset, never typed.
  3. Never `sleep` timers in a background shell: Claude Code stops idle background shells under memory pressure.
- Never state a resume time as certain unless an OS task backs it.

## 6. Report

When you pause or resume, tell the user in one line: the two percentages, the reset time in their local time, and what will happen next. Example:

> Weekly 47%, 5-hour 94%, resets 17:40. Finishing the step in hand, then pausing. A one-time task is set for 17:41 to resume from `HANDOFF.md`.

## 7. This session's context window: heads-ups at 50, 60 and 70%

The context window is per session (unlike the account limits). The status line writes it for each session to `<config>/usage-sessions/$CLAUDE_CODE_SESSION_ID.json`, and `read-usage.cjs` reads it for you.

- `context_window.used_percentage` (and `context_window_size`, `total_input_tokens`); `at` is when it was written. It refreshes when the status line redraws, so read it after a turn's work, not before the first reply. No file (another machine, an older status line): say so once and judge by the conversation's length.
- Read it whenever you read the account numbers (start of a task, between phases, before a report).
- **Compact by 70%, never later.** Waiting for auto-compaction at a full window is never a good idea: when the window is full, the work gets worse. Plan a compaction from 50%; do it at the first safe point between 50% and 70%. A session cannot run `/compact` on itself: say "safe to /compact now" to the user, and the user types it.
- **Checkpoints:** when the session first reaches **50%**, **60%** and **70%**, give the user ONE short heads-up per checkpoint (never repeat one): the percentage, and whether NOW is a safe moment to compact. At 70% the compaction is due at the very next safe point.
- **Safe to compact now** means: none of your agents, panels or reviewers is running or about to report; no CI result is about to drive a merge or an apply in the next minutes; no production, database or money step is mid-way; and everything in flight is written to files (ledger, board, plan, handoff), because a compaction keeps only a summary and reports arriving during it can be lost.
- If it is safe: "This session's context is at 60%. This is a safe point to compact: nothing is running. I recommend /compact now." If it is not: say what is still running and that you will say when the window opens, then do.
- **Past 70% (a miss):** compact at the very next safe point; a fresh session from a written handoff only after more than 5 compactions (section 8) or on the user's word.
- **Relaying for other sessions** (a lead passing department alerts to the user): relay only a checkpoint with its number read from that session's context file ("context 60% (file), safe"). "Safe to compact" alone only means a window is open, not that a compaction is needed; a guessed percentage from a session with no file is not a checkpoint either. Without a number, ask the session first.
- Before recommending a compaction, write down anything that lives only in the conversation (decisions, open questions, the next step), so the summary cannot lose it.

## 8. Compaction count: a fresh session after more than 5

A SessionStart hook (matcher `compact`, `scripts/count-compactions.cjs`) counts every compaction of this session in `<config>/usage-sessions/$CLAUDE_CODE_SESSION_ID.compactions.json` and reports the count after each one. No hook: count the compaction summaries in your context; seed the file with the true number if it started late.

- **More than 5 compactions** (the hook also shows the user a notice), or earlier when the session is bloated at a clean boundary: recommend a fresh session.
  1. Write a `HANDOFF.md` that a session knowing nothing can continue from: goal, state, decisions and reasons, open items and owners, exact next steps, key files and commands, anything still running.
  2. Write ONE start line: `Read <path>/HANDOFF.md in full, then continue from its "Next steps". <role>.`
  3. Either give the user the start line to paste into a new session, or (unattended work) start the successor yourself through a ONE-TIME OS scheduled task, never as a child process of this session: a session launched from inside another saves no transcript and cannot be resumed. The lead-loop skill describes this self-replicating handover in full.
  4. When the new session confirms it took over, tell the user "SAFE TO CLOSE" with a checklist (state pushed, nothing left scheduled, no child runs).
  5. On the user's OK, the new session closes the old one by its PID, without killing the process tree.
