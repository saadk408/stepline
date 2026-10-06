# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Stepline is a Claude Code **mod**: a plugin whose behaviour is a TypeScript hooks module (`hooks/hooks.json` names `hooks/register.tsx`). It turns a plan approved in plan mode into a checklist in the band above the prompt, plus a pane, and gives Claude an `update_step` tool to check steps off.

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
- **`hooks/plan.ts`** holds the pure functions, with no `$`: the haiku prompt (`SPLIT_SYSTEM`, `splitPrompt`), reading the model's reply (`parseSplit`), the fallback parser (`parsePlan`), title matching (`normalize`, `stepFor`), and the `update_step` result text (`updateResult`, `readUpdateResult`). `tests/plan.test.ts` tests them directly.
- **`types/index.d.ts`** is the `$.state` contract. Every `$.state` key the module uses must be declared under `PluginState['stepline']`, or `validate` refuses it. It also types the tool's input through `McpToolInputs`.

### State and persistence

- **Session state:** three `$.state` atoms, `plan`, `isPaneOpen` and `isDoneSeen`. They survive a hot reload; the module's own variables don't, because a reload re-runs `register` and fires `session.start` again. Keep anything that has to survive in atoms.
- **Per-project state:** `$.store`, keyed `plan:<project root>`. All sessions on the machine share it.
- **A plan's identity is its `approvedAt`.** `save()` never overwrites a stored plan with a newer `approvedAt`. `withSaved()` merges check-offs that another session saved for the same approval.
- **`knownBy` is the id of the session whose Claude has been given the checklist.** In any other session, the band shows only the one-line "Unfinished … /stepline to resume", and `/stepline` hands the checklist over through `context`.
- **`/clear`, `/resume` and `/branch` reset `$.state` without firing `session.start`.** The `classic.SessionStart` hook restores the plan from the store instead. After `/clear` it blanks `knownBy`, so the next `/stepline` hands the checklist over again.

### Main flow

1. A `tool.call` hook on `ExitPlanMode` awaits `next(e)` first, then reads the plan text from the result, or reads `filePath` with `$.fs.read`.
2. `splitPlan` asks `haiku` for the steps through `$.model.complete`, and falls back to `parsePlan` when the call fails or is refused.
3. The plan is saved, and `announce(plan)` is added to the result's `context`. That's the text Claude receives.
4. `update_step` is registered with `$.tool.register` in `session.start` and answered by its own `tool.call` hook. `tool.check` approves it without a prompt, and `tool.describe` sets `isDeferred: false` so it's always in Claude's tool list.
5. `TodoWrite`, `TaskCreate` and `TaskUpdate` are observed after `next(e)`. Items whose titles match a step through `stepFor` mirror their status onto it.

### Drawing

- **Band (`ui.render` on `AbovePrompt`):** draws the plan card and always calls `next(e)`, so whatever other mods and Claude Code draw stays underneath it. The band steps aside while the pane is open, while a survey shows, and once a turn has started after the plan finished (`turn.start` sets `isDoneSeen`).
- **Pane (`ui.render` on `Pane`, `requestId: 'stepline'`):** opens only on a person's action, from the band's button or `/stepline`.
- **Transcript rows (`ToolUse` and `ToolResult` for `mcp__stepline__update_step`):** each call becomes one dim line, and its result block is hidden. The row takes its title and count from the result text through `readUpdateResult`, so `updateResult` and `readUpdateResult` must change together. Errors and interruptions fall through to Claude Code's own drawing.

### Conventions

- Hooks at gating sites end with `.catch(($, e, next) => next(e))`, so a failure hands the event back to Claude Code instead of skipping it. There are two exceptions:
  - The `update_step` call hook's `.catch` answers with an error result, because no engine behaviour sits beneath that tool.
  - `tool.check` has no `.catch`, since it only approves its own tool.
- The observe-only `turn.start` is used instead of `prompt.submit` on purpose: the mod must not be able to change a prompt.

## Tests

`tests/stepline.test.ts` runs the module against a stand-in engine.

- **`world(on, options)`** answers engine events with `on(...)`: the store is a `Map`, `ui.open`/`ui.close`/`ui.toast` calls are recorded, and the model's reply is set through `options.modelText`.
- **`start($)`** begins a session in `/repo`.
- **`band()` and `pane()`** mount the UI so tests can `find` text in it.
- Inline plugins such as `neighbor` and `watcher` are passed through `test(name, { plugins: [...] }, body)`.

## Publishing constraints

The repo is prepared for Anthropic's plugin directory, which follows `main`.

- **Releases:** every merge to `main` that changes what users get raises `version` in `.claude-plugin/plugin.json` and adds a `CHANGELOG.md` entry; Claude Code offers updates only when the version changes. Changes for development only, such as this file or CI, don't need a version bump.
- **The plugin `name`, `stepline`, is permanent.** Change `displayName` for a different label.
- **Disclosures:**
  - The README's "Data and permissions" section names every hook and `$` call that `validate` prints, and quotes `announce()`, the `update_step` description and the command replies verbatim.
  - Any change to hooks, `$` calls, stored fields or model-facing strings must update the README to match, and `PRIVACY.md` and the scope list in `SECURITY.md` where they're affected.
  - `SECURITY.md` links to `README.md#data-and-permissions`, so keep that heading.
- **Files:** keep the source readable (nothing minified or bundled), every file under 256 KiB, and no binaries other than images. `assets/icon.svg` is referenced only from `plugin.json`.
