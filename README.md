# Stepline

A Claude Code plugin that turns the plan you approve in plan mode into a live checklist. When you accept a plan, Stepline splits it into steps and shows your progress in the band above the prompt, with the full checklist one press away. Claude checks each step off as it finishes, so you can follow how far a long plan has got without scrolling back through the conversation. When the work drifts from the plan, Claude keeps the checklist in step: it adds a step for something you ask for, retitles one you change, and notes a fix or a tangent it's on.

The band, right above the prompt at any terminal width:

```text
╭──────────────────────────────────────────────────────────────────────────────╮
│ PLAN  Ship the health endpoint              ▰▰▰▰▰▱▱▱▱▱▱▱▱ 2/5   a: all steps │
│ Now   ▶ 3. Write endpoint tests                                              │
│ Next    4. Update the API docs                                               │
╰──────────────────────────────────────────────────────────────────────────────╯
```

While Claude is on something that isn't a step, the `Next` row gives way to an `Aside`:

```text
╭──────────────────────────────────────────────────────────────────────────────╮
│ PLAN  Ship the health endpoint              ▰▰▰▰▰▱▱▱▱▱▱▱▱ 2/5   a: all steps │
│ Now   ▶ 3. Write endpoint tests                                              │
│ Aside ↳ Fixing the import cycle in auth.ts                                   │
╰──────────────────────────────────────────────────────────────────────────────╯
```

The full checklist, in a pane you open from the band or with `/stepline`:

```text
Ship the health endpoint
▰▰▰▰▰▰▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱ 2/5

✔ 1. Add the HealthSerializer
✔ 2. Add the GET /health endpoint
▶ 3. Write endpoint tests
○ 4. Update the API docs
○ 5. Run the linters

Esc or /stepline closes this
```

## Requirements

Claude Code v2.1.290 or later, in the terminal or the Desktop app's Code tab. Stepline is a [mod](https://code.claude.com/docs/en/plugins/mods/overview), and claude.ai chat and Cowork don't run mods.

## Install

In Claude Code, add this repository as a marketplace, then install the plugin from it:

```text
/plugin marketplace add saadk408/stepline
/plugin install stepline@saadk408
```

Claude Code offers an update each time a release raises the plugin's version.

### Coming from plan-progress

Stepline used to be called Plan Progress. If you installed `plan-progress@saadk408`, remove it, refresh the marketplace, then install Stepline:

```text
/plugin uninstall plan-progress@saadk408
/plugin marketplace update saadk408
/plugin install stepline@saadk408
```

A plan tracked under the old name doesn't carry over. A clone loaded through `CLAUDE_CODE_PLUGIN_DIRS` keeps working from its folder.

### From a clone

To work on the plugin, clone the repository, then point Claude Code at the folder:

```bash
git clone https://github.com/saadk408/stepline.git
```

To load it in every session, add the folder to the `env` block of `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/stepline"
  }
}
```

To try it in one session instead, start Claude Code with `claude --plugin-dir /path/to/stepline`. Either way, an interactive session reloads the plugin when you save a change to it.

## How it works

1. **You approve a plan.** Stepline asks a small, fast model (`haiku`) to split the plan into an ordered checklist. It aims for 3 to 12 steps and keeps at most 20. If that call fails, it uses the plan's own numbered list or headings instead, and the pane says so.
2. **The band shows your progress** right away, in a card just above the prompt: a `PLAN` label with the plan's title, a progress bar and count, then the step being worked on (`Now`) and the one after it (`Next`).
3. **The pane holds the full checklist**, one row per step: `○` pending, `▶` in progress, `✔` done, `⊘` skipped. Open it with **All steps** in the band, or with `/stepline`, and close it with Esc or `/stepline` again. The band steps aside while the pane is open and comes back when you close it.
4. **Claude gets the checklist** with the approval, and a tool, `update_step`, to check each step off as it finishes, or mark it skipped. The first unfinished step counts as the one in progress, so Claude marks a step in progress only when it starts one out of order. If Claude also keeps a TodoWrite or Task list, items whose titles match a step check that step off too.

   In the transcript, each check-off is one dim line, such as `✔ plan 2/5 · Add the GET /health endpoint`, in place of the full tool call and its result. Claude still reads the full result, and an error from the tool shows in full.
5. **The checklist follows the work.** Claude has a second tool, `amend_plan`, for when the work drifts from the plan. When you ask for something no step covers, Claude adds a step; it goes at the end with the next number, and the pane marks it with `+`. When you change what a step means, Claude retitles it. Before a fix or a tangent, Claude notes an aside: a few words that take the `Next` row's place under `Now` until it checks a step off or you send your next prompt. An in-progress item in Claude's todo list that matches no step shows as an aside too. In the transcript, each of these is one dim line, such as `+ plan 2/6 · Add rate limiting` or `↳ Fixing the import cycle`. Only the main conversation changes the checklist: a subagent's call to either tool does nothing, and a subagent's todo and task lists aren't mirrored, since the step that covers a subagent's task is Claude's to check off when the subagent reports back.

   If Claude goes back into plan mode and you approve a plan with the same title and at least one step in common, or one that keeps at least half the steps, the steps already done stay checked off, the pane says the plan was revised, and Claude is told so. A plan that looks like different work replaces the old one, and a finished plan is never revised.
6. **Each step checked off** shows a toast. When the whole plan is done, a final toast and a `✔` line in the band say so, and the band goes quiet at your next prompt.

To press **All steps** from the keyboard, give the band focus with ctrl+x tab and press `a`. To fold the band away, press `[-]` beside it or ctrl+x ctrl+a. The band gives way to Claude Code's surveys, and whatever other plugins draw there stays in the band, under the plan. On a wide terminal the card stops growing at 120 columns.

## Examples

### Plan a change and watch it check off

Enter plan mode with `/plan` or shift+tab, then ask for a change that takes a few steps:

```text
Add a GET /health endpoint that reports the app version and whether the database answers. Include tests and a line in the API docs.
```

Read the plan Claude proposes and approve it. The band shows the plan's title, a count such as `0/5`, and the first step under `Now`. As Claude finishes each step, the bar fills, a toast such as `✔ 2. Add the GET /health endpoint (2/5)` appears, and the transcript gets one dim line, `✔ plan 2/5 · Add the GET /health endpoint`. Press ctrl+x tab, then `a`, to see every step at once.

### Pick up an unfinished plan in a new session

Quit partway through, then come back later. A new session in the same project shows one line in the band, `Unfinished: "Ship the health endpoint" 2/5 · /stepline to resume`. Run:

```text
/stepline
```

The pane opens with the checklist, and Claude gets the steps back, marked as they were. Close the pane with Esc and ask Claude to go on:

```text
Carry on with the plan from step 3.
```

### Let Claude's todo list check steps off

If you also want Claude's own todo list, ask for one after you approve the plan:

```text
Keep a todo list for this plan as you work, one item per step, using the step titles.
```

When Claude marks a todo item done, the step with the same title checks off, even if Claude doesn't call `update_step` for it. Titles match when they're the same apart from case, punctuation, and a leading number such as `3.`. A Task list (TaskCreate and TaskUpdate) works the same way.

### Change the plan as you go

Partway through, ask for something the plan didn't cover:

```text
Also add a rate limit to the endpoint, 60 requests a minute.
```

Claude adds a step, the band's count goes from `2/5` to `2/6`, a toast says `+ 6. Add a rate limit to the endpoint (2/6)`, and the pane shows the new step last, marked `+`. To change a step instead, say so:

```text
For step 4, document the endpoint in the OpenAPI file, not the README.
```

Claude retitles step 4, and the band and pane show the new wording. When Claude stops to fix something first, the band shows an `Aside` row in place of `Next`, such as `↳ Fixing the import cycle in auth.ts`, until it checks the next step off.

### Stop tracking a plan

When you drop a plan partway, tell Claude, then clear it:

```text
Let's stop here and leave the API docs for another day.
```

```text
/stepline clear
```

Stepline replies `Stopped tracking "Ship the health endpoint".`, the band empties, the pane closes, and the saved plan for this project is removed. If Claude tries to check a step off afterwards, the tool tells it no plan is being tracked. You don't need this before a new plan: approving one replaces the old one.

## Commands

| Command | What it does |
| :- | :- |
| `/stepline` | Opens the pane with the full checklist, or closes it when it's open. In a new session, it also hands the checklist back to Claude so it can carry on. |
| `/stepline clear` | Stops tracking the plan, clears the band, and closes the pane. |

## Across sessions

The plan is saved per project. A new session in the same project shows it as one line in the band, `Unfinished: "…" 2/5 · /stepline to resume`. `/stepline` hands the checklist back to Claude. The plan also comes back after `/clear`, `/resume`, and `/branch`. Approving a new plan replaces the old one. Two sessions in one project keep each other's check-offs and added steps, and a plan approved later in another session is never overwritten. When one session approves a revision of the plan, the others show it as an unfinished plan and `/stepline` hands the new checklist to their Claude; a check-off made there before that is refused with a line that says so.

## Data and permissions

Everything Stepline hooks, runs, sends, and stores. The names in parentheses are the ones `claude plugin validate .` prints on its `hooks:` and `calls:` lines. [PRIVACY.md](PRIVACY.md) covers the same ground as a privacy policy.

- **One model call per approved plan** (`$.model.complete`). The plan's text goes to `haiku` with an instruction to split it into steps. The instruction is in [hooks/plan.ts](hooks/plan.ts). The call runs through your own Claude Code session and credentials, and counts toward your usage. Stepline makes no other model calls.
- **At most one file read per approved plan** (`$.fs.read`). When the approval doesn't carry the plan's text, Stepline reads the plan file Claude Code saved for it. It reads no other file.
- **Four tool calls it watches** (`tool.call` on `ExitPlanMode`, `TodoWrite`, `TaskCreate`, and `TaskUpdate`). Each call runs first, as Claude made it. Then Stepline reads only what it needs:
  - from `ExitPlanMode`, the approved plan's text or the path of its file
  - from `TodoWrite`, each item's text and status; an in-progress item that matches no step shows in the band as the aside
  - from `TaskCreate`, the subject and the new task's id
  - from `TaskUpdate`, the task's id, subject, and status

  It skips calls that were denied or failed, and every call made inside a subagent. It changes none of these calls' inputs or results. The only addition is the checklist text quoted below, which goes to Claude alongside the approval.
- **Told when each turn starts** (`turn.start`). Stepline uses this to quiet the band at the first turn after a plan finishes, and to clear the aside. The event carries your prompt. Stepline ignores its text, and this hook can't change or block the prompt.
- **Its own tools** (`$.tool.register`, `tool.call`). Stepline registers `mcp__stepline__update_step` and `mcp__stepline__amend_plan` and answers calls to those two tools itself; it answers no other tool's call. They change only the checklist and the aside, and only from the main conversation: a subagent's call to either answers that it did nothing. Stepline doesn't answer any tool's permission check, its own included, so each call goes through your permission mode and rules like any other tool. To skip the prompt, allow the two tools in `/permissions` with the rule `mcp__stepline__*`, or one rule per tool, `mcp__stepline__update_step` and `mcp__stepline__amend_plan`.
- **Both tools' schemas are always in Claude's tool list** (`tool.describe`). Stepline marks `update_step` and `amend_plan` as not deferred, so their names, descriptions, and input schemas are in Claude's tool list in every session, even with no plan. That's a small, constant context cost, and it lets Claude call them without searching for them first.
- **Text added to Claude's context** (`tool.call` on `ExitPlanMode`, `command.run`). On approval, and when `/stepline` hands the plan back in a new session or after `/clear`, Claude receives the text quoted below. Claude also reads the one line each `/stepline` command prints and the one line each `update_step` or `amend_plan` call returns, all quoted below. Stepline adds nothing else to Claude's context.
- **What it draws** (`ui.render` on `AbovePrompt`, `Pane`, `ToolUse`, and `ToolResult`; `ui.close`; `$.ui.resolve`, `$.ui.open`, `$.ui.close`, `$.ui.panes`, `$.ui.toast`). Its card in the band above the prompt, keeping whatever Claude Code and other plugins draw there. Its own pane, which opens only when you ask for it; Stepline is told when the pane closes, so the band can come back. Toasts. In the transcript, it redraws only the rows for its own tools' calls and results (`ToolUse` and `ToolResult` for `mcp__stepline__update_step` and `mcp__stepline__amend_plan`), and an error from either tool still shows in full. Claude Code draws every other row as usual.
- **Its command** (`$.command.register`, `command.run`). `/stepline` and `/stepline clear`, as the Commands section above describes.
- **Local storage only** (`$.store.get`, `$.store.set`, `$.store.delete`, `$.session.root`, `$.session.id`). Stepline saves the plan's title, step titles and statuses, approval time, how it was split, the project path, the id of the session whose Claude has the checklist, the ids of Task items whose titles match a step, which steps were added after the approval, when a step was last added or retitled, and the approval time of the plan it revised, if any, but not the plan's full text. These are saved as JSON in Stepline's own file under `~/.claude/plugins/store/`, one entry per project. Stepline reads the entry back when a session starts and after `/clear`, `/resume`, and `/branch` (`session.start`, `classic.SessionStart`). `/stepline clear` removes the project's entry, and approving a new plan replaces it. Claude Code removes the store if it goes unused for [`cleanupPeriodDays`](https://code.claude.com/docs/en/settings-reference#cleanupperioddays). To remove everything at once, delete Stepline's file in that folder; its name starts with `stepline`.
- **Session state** (`$.state.get`, `$.state.set`). While a session runs, Claude Code holds the plan, the aside's few words, and two flags for Stepline: whether the pane is open, and whether a turn has started since the plan finished. Other plugins in the session can read these values, and only Stepline writes them. They last for the session; only the store entry above is kept.
- **Nothing else.** Stepline makes no network requests of its own, runs no shell commands, writes no files outside its store, changes no settings, and sends no telemetry.

### The text Claude receives

On approval, and when `/stepline` hands the plan back, Claude receives this, with the plan's title and one line per step filled in:

```text
Stepline is tracking the approved plan "<plan title>" as a checklist the person watches above the prompt:
1. [ ] <step 1 title>
2. [ ] <step 2 title>
<one line like these for each step, up to 20>

Work through the steps in order. Call mcp__stepline__update_step with {"step": N, "status": "completed"} as soon as step N is done ("skipped" if the person drops it). The person's view treats the first unfinished step as the one in progress, so call it with "in_progress" only when you start a step out of order. If you also keep a TodoWrite or Task list, use these step titles verbatim.
When the work changes, tell Stepline with mcp__stepline__amend_plan: "add" for work the person asks for that no step covers, "retitle" when the person changes what a step means, and "aside" with a few words before unplanned work such as a fix or a tangent. Don't add steps for your own sub-tasks.
```

When the plan revises one approved earlier, the line `This revises the plan approved earlier; steps already done are marked.` follows the first.

Each step's mark is `[ ]` pending, `[~]` in progress, `[x]` done, or `[-]` skipped. On approval every step is `[ ]`. When `/stepline` hands a plan back, the marks show its progress so far.

The description of `update_step` in Claude's tool list reads:

```text
Updates the checklist of the approved plan that the person watches above the prompt and in the Stepline pane. Call it with status "completed" as soon as a step is done, or "skipped" for a step the person drops. The first unfinished step counts as in progress, so use "in_progress" only when you start a step out of order. Steps are numbered as in the checklist Stepline gave you when the plan was approved.
```

Its two inputs are `step`, a whole number from 1 ("The step number from the checklist."), and `status`, one of `pending`, `in_progress`, `completed`, or `skipped` ("The step’s new status."). Each call returns one line, such as `Step 3 is completed: Write endpoint tests. 3/5 done. Next open step: 4. Update the API docs`, or an error that says what was wrong.

The description of `amend_plan` reads:

```text
Changes the checklist of the approved plan that the person watches above the prompt and in the Stepline pane. "add" appends a step (title required) for work the person asks for that no step covers. "retitle" renames step N (step and title) when the person changes what a step means. "aside" shows a few words under the current step while you do unplanned work such as a fix or a tangent (title; an empty title clears it, and so does your next update_step call). Don’t add steps for your own sub-tasks.
```

Its inputs are `action`, one of `add`, `retitle`, or `aside` ("What changes: a step added, a step retitled, or an aside noted."), `step`, a whole number from 1 ("The number of the step to retitle."), and `title` ("The new step’s title, the step’s new title, or the aside’s few words."). Only `action` is required. An added or retitled step returns the same kind of line as `update_step`, such as `Step 6 is pending: Add a rate limit to the endpoint. 2/6 done. Next open step: 3. Write endpoint tests`. An aside returns `Aside noted: <the words>.` or `Aside cleared.`. From a subagent, either tool returns `Only the main conversation changes the checklist: a subagent’s call does nothing.`. Either tool returns an error that says what was wrong, and when another session has approved a revision of the plan, `The plan was revised in another session (now "<title>", 2/6 done). Run /stepline to pick up the new checklist.`

Each `/stepline` command prints one line in the transcript, and Claude reads it too:

- the plan's title and count, such as `Ship the health endpoint: 2/5 steps done.`, followed by `Claude has the checklist again and can carry on with it.` when the command hands the plan back
- `Closed the checklist.` when the command closes the pane
- `Stopped tracking "Ship the health endpoint".` after `/stepline clear`
- `No approved plan yet. Approve one in plan mode and its steps show up here.` or `No plan was being tracked.` when there's no plan

## Troubleshooting

- **The pane won't close.** Press Esc, or run `/stepline`. While Claude is working, Esc at the prompt interrupts Claude instead, and `/stepline` waits until Claude finishes, so use the ✕ on the pane's frame.
- **The band is empty.** It steps aside while the pane is open and while a survey is showing, and it may be folded away: press `[-]` or ctrl+x ctrl+a. `/stepline` always opens the full checklist.
- **The band shows an aside that's over.** It clears when Claude checks a step off, when you send your next prompt, or when Claude's todo list no longer has that item in progress.
- **Claude is asked before each check-off.** Calls to `update_step` and `amend_plan` go through your permission rules like any other tool's. Allow them once in `/permissions`: add `mcp__stepline__*` to the allow list, or `mcp__stepline__update_step` and `mcp__stepline__amend_plan` one by one.
- **Nothing happens at all.** Run `/plugin` and check that it lists `stepline` among the active mods. Start Claude Code with `claude --debug` to see why a hook was skipped.

## Development

```bash
claude plugin validate .            # manifest and hooks module
claude plugin test .                # tests in tests/
claude --plugin-dir .               # load this checkout for one session
```

Claude Code writes the API's type declarations to `.claude-plugin/types/` each time it loads the plugin from a folder you own, after which `tsc -p .` type-checks the module and the tests. Every release raises `version` in `.claude-plugin/plugin.json` and adds a `CHANGELOG.md` entry.

## Support

- **Questions, bugs, and ideas:** open an issue at [github.com/saadk408/stepline/issues](https://github.com/saadk408/stepline/issues).
- **Security vulnerabilities:** report them privately, as [SECURITY.md](SECURITY.md) describes, and not in a public issue.
- **Your data:** [PRIVACY.md](PRIVACY.md) says what Stepline processes and stores, and how to remove it.

## License

MIT. See [LICENSE](LICENSE).
