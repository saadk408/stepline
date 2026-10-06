# Privacy

This policy covers Stepline, a Claude Code plugin by Saad Khan. It says what Stepline reads, sends, and stores while you use it. Stepline has no server and no account, and what it keeps stays on your machine.

## What Stepline sends

- **One model call per approved plan.** When you approve a plan, Stepline sends the plan's text to Claude's `haiku` model, which splits it into steps. The call goes through your own Claude Code session, with the same credentials and API provider as your conversation with Claude, and it counts toward your usage. It carries the plan's text and Stepline's instructions for splitting it, and nothing else from your conversation. If the call fails, Stepline splits the plan on your machine instead. Stepline makes no other model calls.
- **Text added to your conversation with Claude.** On approval, and when `/stepline` hands a plan back in a new session or after `/clear`, Stepline adds the numbered checklist and how to use its `update_step` and `amend_plan` tools to Claude's context. Each time Claude calls `update_step` or `amend_plan`, the tool's result is one line with the step's title and how many steps are done, or the aside's few words. Each `/stepline` command prints one line, such as the plan's title and count, and Claude reads it too. This text goes to Claude with the rest of your conversation.

What happens to the model call and your conversation once they reach your provider is covered by your agreement with Anthropic or that provider, not by this policy.

## What Stepline reads

- **The plan you approve.** Stepline reads the plan's text from the approval. When the approval doesn't carry the text, it reads the plan file Claude Code saved for it. It ignores plans approved inside a subagent.
- **Claude's task lists.** When Claude calls TodoWrite, TaskCreate, or TaskUpdate, Stepline reads each item's title and status, and each task's id, so that items titled like a step check that step off, and an item in progress that matches no step shows in the band as what Claude is doing off the plan. It doesn't change those calls or their results, and it leaves a subagent's lists alone.
- **Your project and session.** Stepline reads the project's path, to keep one plan per project, and the session's id, to know which session's Claude has the checklist.
- **When each turn starts.** Stepline is told when each turn starts, so the band can go quiet after a finished plan and drop the aside. The event carries your prompt, but Stepline ignores its text, and it can't change it.

## What Stepline stores, and where

Stepline saves the plan as JSON in a file of its own under `~/.claude/plugins/store/`, with one entry per project. Each entry holds:

- the plan's title, and each step's title and status
- the time you approved the plan
- the project's path
- the id of the session whose Claude has the checklist
- whether `haiku` or Stepline's fallback split the plan
- the ids of Task items whose titles match a step
- which steps were added after the approval, and when a step was last added or retitled
- the approval time of the plan it revised, when it revised one

It doesn't store the plan's full text. Every session on your machine that loads Stepline reads the same file, which is how a new session picks up an unfinished plan.

While a session runs, Claude Code also holds the plan, the few words of an aside, whether its pane is open, and whether a turn has started since it finished, in that session's memory. Other mods in the same session can read those values, as they can any mod's. They go away when the session ends.

## How long Stepline keeps it

A project's entry stays until one of these happens:

- You run `/stepline clear`. It removes the entry, unless another session has since approved a newer plan in the project.
- You approve a new plan in the same project. It replaces the old one, or, when it revises the old one, carries the finished steps into the new entry.
- No session reads or writes Stepline's store for [`cleanupPeriodDays`](https://code.claude.com/docs/en/settings-reference#cleanupperioddays), 30 days unless you change it. Claude Code then removes the file.

To remove everything at once, delete Stepline's file in `~/.claude/plugins/store/`. Its name starts with `stepline`.

## What Stepline doesn't do

- It makes no network requests of its own. The model call and your conversation go through Claude Code.
- It shares nothing with third parties.
- It sends no telemetry and collects no analytics.
- It runs no shell commands, and it writes no file other than its store.

Nothing leaves your machine except through your own Claude Code session: the one `haiku` call per approved plan, and the text Stepline adds to your conversation with Claude.

## Changes to this policy

A change to this policy ships in a new release, and that release's entry in [CHANGELOG.md](CHANGELOG.md) says what changed.

## Contact

For questions about privacy, open an issue at <https://github.com/saadk408/stepline/issues>. To report a security problem, follow [SECURITY.md](SECURITY.md) instead, and keep it out of public issues.
