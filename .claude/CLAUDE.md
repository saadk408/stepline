# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Stepline is a Claude Code **mod**: a plugin whose behaviour is a TypeScript hooks module (`hooks/hooks.json` names `hooks/register.tsx`). It turns a plan approved in plan mode into a checklist in the band above the prompt, plus a pane, gives Claude an `update_step` tool to check steps off, and an `amend_plan` tool to add or retitle steps and note an aside when the work drifts.

There is no `package.json`, build step or bundler. Claude Code compiles the TSX itself, against a global `h`. The module runs in an environment of its own, with no DOM and no Node APIs; everything outside it goes through `$`. The imports `'claude-code'` and `'claude-code/testing'` resolve to type declarations that Claude Code writes to `.claude-plugin/types/` (gitignored) each time it loads the plugin from this folder. Grep `.claude-plugin/types/claude-code/index.d.ts` for an event or method name to read its contract and docs.

## Commands

```bash
claude plugin validate --strict .   # manifests + hooks module; CI runs exactly this
claude plugin test .                # runs every tests/*.test.ts (no per-test filter; the suite takes about 1s)
claude --plugin-dir .               # load this checkout for one session (an interactive session hot-reloads on save)
tsc -p .                            # type-check, once .claude-plugin/types/ exists
```

- **The `validate` output is the source of truth for what the mod does.** Its `hooks:`, `calls:` and `state` lines list every event hooked, every `$` method called and every `$.state` key. Its `gating hook with/without .catch` lines show which hooks can refuse something.
- **`tsc -p .` can fail with TS2589** ("Type instantiation is excessively deep") on a machine with hundreds of connected MCP tools. The cause is the generated `.claude-plugin/types/claude-code-mcp/index.d.ts`, not this repo; CI doesn't run tsc.
- **CI pins Claude Code `2.1.290`,** the oldest version the README's Requirements section supports. Keep the two in step.

## Architecture

- **`hooks/register.tsx`** holds every hook and all drawing.
- **`hooks/plan.ts`** holds the pure functions, with no `$`: the haiku prompt (`SPLIT_SYSTEM`, `splitPrompt`), reading the model's reply (`parseSplit`), the fallback parser (`parsePlan`), title matching (`normalize`, `stepFor`), step status helpers (`isClosed`, `isDone`), the revision test (`carryOver`), the cross-session step merge (`mergeSteps`), and the `update_step` result text (`updateResult`, `readUpdateResult`), which `amend_plan`'s add and retitle reuse. `tests/plan.test.ts` tests them directly.
- **`types/index.d.ts`** is the `$.state` contract. Every `$.state` key the module uses must be declared under `PluginState['stepline']`, or `validate` refuses it. It also types the tool's input through `McpToolInputs`.

### State and persistence

- **Session state:** four `$.state` atoms, `plan`, `isPaneOpen`, `isDoneSeen` and `aside`. They survive a hot reload; the module's own variables don't, because a reload re-runs `register` and fires `session.start` again. Keep anything that has to survive in atoms.
- **Per-project state:** `$.store`, keyed `plan:<project root>`. All sessions on the machine share it.
- **The aside is session-only.** It's never stored. `turn.start`, any `update_step` call, an empty `amend_plan` aside, a new approval and `/stepline clear` all clear it. An aside from a TodoWrite item (`source: 'todo'`) also clears when a later list has no unmatched in-progress item; one Claude set (`source: 'tool'`) doesn't.
- **A plan's identity is its `approvedAt`.** `save()` never overwrites a stored plan with a newer `approvedAt`. `withSaved()` merges what another session saved for the same approval: statuses from the store, steps either side added, titles from the side with the later `amendedAt` (`mergeSteps`). A stored plan whose `revisedFrom` is this plan's `approvedAt` replaces it: `currentPlan()` adopts it into the atom, and until `/stepline` hands it over (`knownBy`) the tools answer a "revised in another session" error instead of changing it. The band reads the atom only, so another session's changes reach it at this session's next tool call.
- **`knownBy` is the id of the session whose Claude has been given the checklist.** In any other session, the band shows only the one-line "Unfinished … /stepline to resume", and `/stepline` hands the checklist over through `context`.
- **`/clear`, `/resume` and `/branch` reset `$.state` without firing `session.start`.** The `classic.SessionStart` hook restores the plan from the store instead. After `/clear` it blanks `knownBy`, so the next `/stepline` hands the checklist over again.

### Main flow

1. A `tool.call` hook on `ExitPlanMode` awaits `next(e)` first, then reads the plan text from the result, or reads `filePath` with `$.fs.read`.
2. `splitPlan` asks `haiku` for the steps through `$.model.complete`, and falls back to `parsePlan` when the call fails or is refused.
3. `carryOver` decides whether the split revises the tracked plan (not done, at least one step title matches, and the title is the same or at least half the steps match): statuses and `taskIds` carry over by title, and `revisedFrom` is set. The plan is saved, and `announce(plan)` is added to the result's `context`. That's the text Claude receives.
4. `update_step` and `amend_plan` are registered with `$.tool.register` in `session.start` and answered by their own `tool.call` hooks. `tool.check` approves them without a prompt, and `tool.describe` sets `isDeferred: false` so they're always in Claude's tool list. `amend_plan`'s `add` appends `n = max + 1` with `isAdded` (append-only, at most `MAX_STEPS`), `retitle` keeps the status, and both set `amendedAt` through `rewrite()`, which applies a change to the latest step list so two calls in one turn both land; Every call reads the plan through `currentPlan()`, which merges the store first. Both tools act for the main loop only: a call with `e.agentId` set answers `NOT_MAIN` and changes nothing, because the main agent owns the plan and a subagent's task is one of its steps.
5. `TodoWrite`, `TaskCreate` and `TaskUpdate` on the main loop are observed after `next(e)`; a subagent's are left alone. Items whose titles match a step through `stepFor` mirror their status onto it. A TodoWrite's first in-progress item that matches no step becomes the aside.

### Drawing

- **Band (`ui.render` on `AbovePrompt`):** draws the plan card and always calls `next(e)`, so whatever other mods and Claude Code draw stays underneath it. The band steps aside while the pane is open, while a survey shows, and once a turn has started after the plan finished (`turn.start` sets `isDoneSeen`). An aside takes the `Next` row's place.
- **Pane (`ui.render` on `Pane`, `requestId: 'stepline'`):** opens only on a person's action, from the band's button or `/stepline`. It shows the aside under the current step, ` +` after an added step, and a footer for a revised plan.
- **Transcript rows (`ToolUse` and `ToolResult` for `mcp__stepline__update_step` and `mcp__stepline__amend_plan`):** each call becomes one dim line, and its result block is hidden. The row takes its title and count from the result text through `readUpdateResult`, so `updateResult` and `readUpdateResult` must change together; `amend_plan`'s add and retitle answer in that shape for the same reason, and an aside row takes its words from the input. Errors and interruptions fall through to Claude Code's own drawing.

### Conventions

- Hooks at gating sites end with `.catch(($, e, next) => next(e))`, so a failure hands the event back to Claude Code instead of skipping it. The exceptions:
  - The `update_step` and `amend_plan` call hooks' `.catch` answer with an error result, because no engine behaviour sits beneath those tools.
  - `tool.check` has no `.catch`, since it only approves the mod's own tools.
- The observe-only `turn.start` is used instead of `prompt.submit` on purpose: the mod must not be able to change a prompt.

## Gotchas

- Keep this file at `.claude/CLAUDE.md`. The repo root is the plugin root, and a `CLAUDE.md` there fails `validate --strict` and CI. Check `validate`'s exit status before pushing; piping it into `tail` hides a failure.
- A session that loads this checkout (`--plugin-dir` or `CLAUDE_CODE_PLUGIN_DIRS`) reloads it at the end of each turn that edits it. Renaming the tool or the command breaks that session's own use of the old names.
- `mark()` applies any mirrored status, `pending` included. A fresh TodoWrite list whose items match finished steps un-checks them. Known and unfixed.
- The test kit's `$.tool.call` drops `agentId` by contract, so the main-loop guards (`NOT_MAIN` in both tools, the mirrors' early return) can't be exercised by the suite. Check them by reading.
- `carryOver` matches by `normalize`d title, so a revision that rewords every step is a replacement and loses the check-offs. Two sessions that add a step at the same time both mint the same `n`; the later `amendedAt` keeps its title. Both known.

## Tests

`tests/stepline.test.ts` runs the module against a stand-in engine.

- **`world(on, options)`** answers engine events with `on(...)`: the store is a `Map`, `ui.open`/`ui.close`/`ui.toast` calls are recorded, and the model's reply is set through `options.modelText`.
- **`start($)`** begins a session in `/repo`.
- **`band()` and `pane()`** mount the UI so tests can `find` text in it.
- Inline plugins such as `neighbor` and `watcher` are passed through `test(name, { plugins: [...] }, body)`.
- Tests raise events through `$` as the engine would: `$.tool.call({ tool: 'ExitPlanMode' })`, `$.command.run({ command: 'stepline', args, ...COMMAND })`, `$.turn.start({ text, turnId })`.

## Publishing constraints

The repo is prepared for Anthropic's plugin directory, which follows `main`.

- **Releases:** every merge to `main` that changes what users get raises `version` in `.claude-plugin/plugin.json` and adds a `CHANGELOG.md` entry; Claude Code offers updates only when the version changes. Changes for development only, such as this file or CI, don't need a version bump.
- **The plugin `name`, `stepline`, is permanent.** Change `displayName` for a different label.
- **`validate` checks only that the files are well-formed.** The directory's own rules (README length, license, name, file limits, security scan) run in the portal's **Validate** at claude.ai/directory/manage.
- **Disclosures:**
  - The README's "Data and permissions" section names every hook and `$` call that `validate` prints, and quotes `announce()`, the `update_step` description and the command replies verbatim.
  - Any change to hooks, `$` calls, stored fields or model-facing strings must update the README to match, and `PRIVACY.md` and the scope list in `SECURITY.md` where they're affected.
  - `SECURITY.md` links to `README.md#data-and-permissions`, so keep that heading.
- **Files:** keep the source readable (nothing minified or bundled), every file under 256 KiB, and no binaries other than images. `assets/icon.svg` is referenced only from `plugin.json`.
