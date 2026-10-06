# Changelog

Each release raises `version` in `.claude-plugin/plugin.json`. Claude Code offers an update only when that number changes.

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
