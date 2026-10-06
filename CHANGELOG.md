# Changelog

Each release raises `version` in `.claude-plugin/plugin.json`. Claude Code offers an update only when that number changes.

## 1.2.0

- **The checklist follows the work.** A second tool, `mcp__stepline__amend_plan`, lets Claude add a step for something you ask for that no step covers (it goes at the end with the next number, marked `+` in the pane), retitle a step when you change what it means, and note an aside: a few words on a fix or a tangent, shown in the band in place of `Next` until the next check-off or your next prompt. An in-progress TodoWrite item that matches no step shows as an aside too. Each call is one dim transcript line, and the tool is allowed without a prompt and kept in Claude's tool list, like `update_step`.
- **Only the main conversation changes the checklist.** A subagent's `update_step` or `amend_plan` call answers that it did nothing, and a subagent's TodoWrite, TaskCreate and TaskUpdate calls no longer check steps off. The step that covers a subagent's task is Claude's to check off when the subagent reports back.
- **Revised plans keep their progress.** Approving a plan with the same title as the one being tracked and at least one step in common, or one that keeps at least half its steps, carries the finished steps over, says so in the pane, and tells Claude. A plan for different work still replaces the old one, and a finished plan is never revised.
- **Steps added in one session reach the others.** Sessions in one project merge each other's added steps and titles. When one session approves a revision, the others offer it through `/stepline`, and a check-off made there before that says so instead of being dropped.
- **Stored fields.** The saved plan gains which steps were added, when a step was last added or retitled, and the approval time of the plan it revised. The README, `PRIVACY.md`, and `SECURITY.md` describe the second tool and these fields.

## 1.1.0

- **Renamed to Stepline.** The plugin is now `stepline`, shown as Stepline, and the repository is `saadk408/stepline`. If you installed `plan-progress@saadk408`, run `/plugin uninstall plan-progress@saadk408`, then `/plugin marketplace update saadk408` and `/plugin install stepline@saadk408`. A plan saved under the old name doesn't carry over, so approve it again to track it. A clone loaded through `CLAUDE_CODE_PLUGIN_DIRS` keeps working from its folder.
- **A new command and tool name.** `/stepline` opens or closes the pane and hands the checklist back to Claude in a new session, and `/stepline clear` stops tracking. Claude checks steps off with `mcp__stepline__update_step`.
- **Fields for Anthropic's plugin directory.** `.claude-plugin/plugin.json` points at an icon, `assets/icon.svg`, and at the README, the issue tracker and `PRIVACY.md` for documentation, support and privacy. The directory reads these fields. Claude Code ignores them.
- **`PRIVACY.md` and `SECURITY.md`.** `PRIVACY.md` says what the plugin processes, what it stores, where, and for how long. `SECURITY.md` says how to report a vulnerability privately.
- **A fuller README.** An Examples section has prompts to try, and a Support section links to issues, `SECURITY.md` and `PRIVACY.md`. Data and permissions now lists all that `claude plugin validate` reports: the tool calls the plugin reads, the turns it's told about, the tool schema it keeps loaded, and the exact text it adds to Claude's context.
- **The band goes quiet on `turn.start`.** The band still goes quiet at the first turn after a plan is done. The plugin learns of that turn from `turn.start`, an event it can only observe, and ignores the prompt's text. It no longer hooks `prompt.submit`, so it can't change a prompt.

## 1.0.1

- **A sturdier start after `/clear`, `/resume` and `/branch`.** When the saved plan can't be read there, the hook that restores it hands the session start back to Claude Code, like every other hook in the plugin, instead of being skipped as a failure.
- **Installable from GitHub.** The repository is its own marketplace: `/plugin marketplace add saadk408/plan-progress`, then `/plugin install plan-progress@saadk408`.
- **A fuller manifest.** `.claude-plugin/plugin.json` has a display name, description, author, homepage, repository, license and keywords, so `claude plugin validate --strict` passes, and CI runs it that way.
- **MIT licensed.**

## 1.0.0

- **A checklist for every approved plan.** Approving a plan in plan mode splits it into steps with `haiku`, or with the plan's own list when that call fails.
- **Progress in the band above the prompt.** A card framed in the plan-mode color shows a `PLAN` label with the title, a progress bar and count, and the `Now` and `Next` steps, at any terminal width and up to 120 columns wide. The band gives way to surveys, keeps what other plugins draw there, and goes quiet at the first prompt after the plan is done.
- **The full checklist in a pane.** **All steps** in the band, or `/plan-progress`, opens a pane with one row per step. The band steps aside while the pane is open. Esc or `/plan-progress` closes it, and it never opens by itself.
- **Check-offs from Claude.** Claude checks each step off with the plugin's `update_step` tool, one call per step, and marks a step in progress only when it starts one out of order. Each call shows in the transcript as one dim line, such as `✔ plan 2/5 · Add the endpoint`. TodoWrite and Task items titled like a step check it off too.
- **Toasts.** One for each step checked off, and one when the plan is done.
- **Kept across sessions.** The plan is saved per project and comes back in a new session and after `/clear`, `/resume`, and `/branch`. Sessions in one project keep each other's check-offs and never overwrite a newer plan.
- **Commands.** `/plan-progress` opens or closes the pane and hands the checklist back to Claude in a new session; `/plan-progress clear` stops tracking.
