# Plan Progress

A Claude Code plugin that turns the plan you approve in plan mode into a live checklist. When you accept a plan, Plan Progress splits it into steps and shows your progress in the band above the prompt, with the full checklist one press away. Claude checks each step off as it finishes, so you can follow how far a long plan has got without scrolling back through the conversation.

The band, right above the prompt at any terminal width:

```text
╭──────────────────────────────────────────────────────────────────────────────╮
│ PLAN  Ship the health endpoint              ▰▰▰▰▰▱▱▱▱▱▱▱▱ 2/5   a: all steps │
│ Now   ▶ 3. Write endpoint tests                                              │
│ Next    4. Update the API docs                                               │
╰──────────────────────────────────────────────────────────────────────────────╯
```

The full checklist, in a pane you open from the band or with `/plan-progress`:

```text
Ship the health endpoint
▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱ 2/5

✔ 1. Add the HealthSerializer
✔ 2. Add the GET /health endpoint
▶ 3. Write endpoint tests
○ 4. Update the API docs
○ 5. Run the linters
```

## Requirements

Claude Code v2.1.290 or later, in the terminal or the Desktop app's Code tab. The plugin is a [mod](https://code.claude.com/docs/en/plugins/mods/overview), and claude.ai chat and Cowork don't run mods.

## Install

In Claude Code, add this repository as a marketplace, then install the plugin from it:

```text
/plugin marketplace add saadk408/plan-progress
/plugin install plan-progress@saadk408
```

Claude Code offers an update each time a release raises the plugin's version.

### From a clone

To work on the plugin, clone the repository, then point Claude Code at the folder:

```bash
git clone https://github.com/saadk408/plan-progress.git
```

To load it in every session, add the folder to the `env` block of `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/plan-progress"
  }
}
```

To try it in one session instead, start Claude Code with `claude --plugin-dir /path/to/plan-progress`. Either way, an interactive session reloads the plugin when you save a change to it.

## How it works

1. **You approve a plan.** Plan Progress asks a small, fast model (`haiku`) to split the plan into an ordered checklist. It aims for 3 to 12 steps and keeps at most 20. If that call fails, it uses the plan's own numbered list or headings instead, and the pane says so.
2. **The band shows your progress** right away, in a card just above the prompt: a `PLAN` label with the plan's title, a progress bar and count, then the step being worked on (`Now`) and the one after it (`Next`).
3. **The pane holds the full checklist**, one row per step: `○` pending, `▶` in progress, `✔` done, `⊘` skipped. Open it with **All steps** in the band, or with `/plan-progress`, and close it with Esc or `/plan-progress` again. The band steps aside while the pane is open and comes back when you close it.
4. **Claude gets the checklist** with the approval, and a tool, `update_step`, to check each step off as it finishes, or mark it skipped. The first unfinished step counts as the one in progress, so Claude marks a step in progress only when it starts one out of order. If Claude also keeps a TodoWrite or Task list, items whose titles match a step check that step off too.

   In the transcript, each check-off is one dim line, such as `✔ plan 2/5 · Add the GET /health endpoint`, in place of the full tool call and its result. Claude still reads the full result, and an error from the tool shows in full.
5. **Each step checked off** shows a toast. When the whole plan is done, a final toast and a `✔` line in the band say so, and the band goes quiet at your next prompt.

To press **All steps** from the keyboard, give the band focus with ctrl+x tab and press `a`. To fold the band away, press `[-]` beside it or ctrl+x ctrl+a. The band gives way to Claude Code's surveys, and whatever other plugins draw there stays in the band, under the plan. On a wide terminal the card stops growing at 120 columns.

## Commands

| Command | What it does |
| :- | :- |
| `/plan-progress` | Opens the pane with the full checklist, or closes it when it's open. In a new session, it also hands the checklist back to Claude so it can carry on. |
| `/plan-progress clear` | Stops tracking the plan, clears the band, and closes the pane. |

## Across sessions

The plan is saved per project. A new session in the same project shows it as one line in the band, `Unfinished: "…" 2/5 · /plan-progress to resume`. `/plan-progress` hands the checklist back to Claude. The plan also comes back after `/clear`, `/resume`, and `/branch`. Approving a new plan replaces the old one. Two sessions in one project keep each other's check-offs, and a plan approved later in another session is never overwritten.

## Data and permissions

Everything Plan Progress runs, sends, and stores:

- **One model call per approved plan.** The plan's text goes to `haiku` through your own Claude Code session and credentials, and counts toward your usage. The plugin makes no other model calls.
- **One file read per approved plan.** When the approval doesn't carry the plan's text, the plugin reads the plan file Claude Code saved for it.
- **Its own tool is approved automatically.** The plugin answers the permission check for `mcp__plan-progress__update_step` with allow, so you aren't prompted each time Claude checks a step off. That tool only changes the checklist. The plugin doesn't change the permissions of any other tool.
- **Text added to Claude's context.** On approval, and when `/plan-progress` hands the plan back, Claude receives the numbered checklist and how to use `update_step`.
- **Local storage only.** The plan's title, step titles and statuses, approval time, project path, session id, and the ids of matching TodoWrite or Task items are saved as JSON in the plugin's store under `~/.claude/plugins/store/`, one entry per project. `/plan-progress clear` removes the entry. Claude Code removes the store if it goes unused for [`cleanupPeriodDays`](https://code.claude.com/docs/en/settings-reference#cleanupperioddays).
- **Nothing else.** The plugin makes no network requests of its own, runs no shell commands, and sends no telemetry.

## Troubleshooting

- **The pane won't close.** Press Esc, or run `/plan-progress`. While Claude is working, Esc at the prompt interrupts Claude instead, so use `/plan-progress` or the ✕ on the pane's frame.
- **The band is empty.** It steps aside while the pane is open and while a survey is showing, and it may be folded away: press `[-]` or ctrl+x ctrl+a. `/plan-progress` always opens the full checklist.
- **Nothing happens at all.** Run `/plugin` and check that it lists `plan-progress` among the active mods. Start Claude Code with `claude --debug` to see why a hook was skipped.

## Development

```bash
claude plugin validate .            # manifest and hooks module
claude plugin test .                # tests in tests/
claude --plugin-dir .               # load this checkout for one session
```

Claude Code writes the API's type declarations to `.claude-plugin/types/` each time it loads the plugin from a folder you own, after which `tsc -p .` type-checks the module and the tests. Every release raises `version` in `.claude-plugin/plugin.json` and adds a `CHANGELOG.md` entry.

## License

MIT. See [LICENSE](LICENSE).
