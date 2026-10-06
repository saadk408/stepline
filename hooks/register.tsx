import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Plan, PlanStep, StepStatus } from '../types'

import { parsePlan, parseSplit, readUpdateResult, SPLIT_SYSTEM, splitPrompt, stepFor, updateResult } from './plan'
import type { Split } from './plan'

const PANE = 'plan-progress'
const PANE_TITLE = 'Plan'
const TOOL = 'update_step'
const TOOL_NAME = 'mcp__plan-progress__update_step'
const MAX_STEPS = 20

const planAtom = atom({ plugin: 'plan-progress', key: 'plan' } as const, null as Plan | null)
const paneOpenAtom = atom({ plugin: 'plan-progress', key: 'isPaneOpen' } as const, false)
const doneSeenAtom = atom({ plugin: 'plan-progress', key: 'isDoneSeen' } as const, false)
/** Cells for the band's label column: PLAN, Now, Next. */
const LABEL_WIDTH = 6
/** The band's card stops growing here, so on a wide terminal the bar stays near the title. */
const CARD_MAX_WIDTH = 120

const STATUSES: readonly StepStatus[] = ['pending', 'in_progress', 'completed', 'skipped']
const ICON: Record<StepStatus, string> = {
  pending: '○',
  in_progress: '▶',
  completed: '✔',
  skipped: '⊘',
}
const ICON_COLOR: Record<StepStatus, string> = {
  pending: 'subtle',
  in_progress: 'claude',
  completed: 'success',
  skipped: 'inactive',
}
const MARK: Record<StepStatus, string> = {
  pending: ' ',
  in_progress: '~',
  completed: 'x',
  skipped: '-',
}

type Change = { n: number; status: StepStatus }

const isStatus = (value: unknown): value is StepStatus =>
  typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
const isClosed = (status: StepStatus) => status === 'completed' || status === 'skipped'
const doneCount = (plan: Plan) => plan.steps.filter(step => isClosed(step.status)).length
const isDone = (plan: Plan) => plan.steps.every(step => isClosed(step.status))
const storeKey = (root: string) => `plan:${root}`
/** The step being worked on: the one in progress, else the first still open. */
const currentStep = (plan: Plan) =>
  plan.steps.find(step => step.status === 'in_progress') ??
  plan.steps.find(step => !isClosed(step.status))

function asPlan(value: unknown): Plan | null {
  if (typeof value !== 'object' || value === null) return null
  const plan = value as Partial<Plan>
  return Array.isArray(plan.steps) && typeof plan.title === 'string' ? (plan as Plan) : null
}

async function splitPlan(
  $: EngineInterface,
  planText: string,
  signal: AbortSignal
): Promise<Split & { splitBy: Plan['splitBy'] }> {
  try {
    const reply = await $.model.complete(
      {
        model: 'haiku',
        system: SPLIT_SYSTEM,
        prompt: splitPrompt(planText),
        maxTokens: 1024,
        effort: 'low',
        timeoutMs: 30_000,
      },
      { signal }
    )
    const split = reply.isAnswered ? parseSplit(reply.text) : undefined
    if (split) return { ...split, splitBy: 'model' }
  } catch {
    // A refused request falls back to the parser like a failed one.
  }
  return { ...parsePlan(planText), splitBy: 'parser' }
}

// What the model and the person read

function checklist(plan: Plan): string {
  return plan.steps.map(step => `${step.n}. [${MARK[step.status]}] ${step.title}`).join('\n')
}

function announce(plan: Plan): string {
  return [
    `plan-progress is tracking the approved plan "${plan.title}" as a checklist the person watches above the prompt:`,
    checklist(plan),
    '',
    `Work through the steps in order. Call ${TOOL_NAME} with {"step": N, "status": "completed"} as soon as step N is done ("skipped" if the person drops it). The person's view treats the first unfinished step as the one in progress, so call it with "in_progress" only when you start a step out of order. If you also keep a TodoWrite or Task list, use these step titles verbatim.`,
  ].join('\n')
}

function progressLine(plan: Plan): string {
  const next = plan.steps.find(step => !isClosed(step.status))
  const count = `${doneCount(plan)}/${plan.steps.length} done`
  return next === undefined
    ? `All ${plan.steps.length} steps are done (${count}).`
    : `${count}. Next open step: ${next.n}. ${next.title}`
}

/** The plan saved for the project, as this or another session left it. */
async function storedPlan($: EngineInterface, root: string): Promise<Plan | null> {
  return asPlan(await $.store.get(storeKey(root)))
}

/**
 * Copies the project's saved plan into the session: at its start, where a hot
 * reload keeps the session's own value, and after a reset of `$.state`.
 */
async function restorePlan(
  $: EngineInterface,
  reset?: 'clear' | 'resume' | 'fork'
): Promise<Plan | null> {
  const held = await read($, planAtom)
  if (held !== null && reset === undefined) return held
  const stored = await storedPlan($, await $.session.root())
  if (stored === null) return held
  // After /clear the model no longer holds the checklist, so the next
  // /plan-progress hands it over again.
  return update($, planAtom, () => (reset === 'clear' ? { ...stored, knownBy: '' } : stored))
}

/**
 * Opens the full checklist, which hides the band while it's up. Only the
 * person opens it, from the band or /plan-progress, so it's placed at any width.
 * It takes the keyboard where it can, and Escape closes it: ctrl+x x only
 * reaches a pane that already holds the keys.
 */
async function openPane($: EngineInterface) {
  const opened = await $.ui.open({ id: PANE, title: PANE_TITLE, focus: true, closeOnEscape: true })
  if (opened.isPlaced) await update($, paneOpenAtom, () => true)
}

/** Reads whether the pane is up from the engine, after `$.state` was reset. */
async function syncPane($: EngineInterface) {
  const panes = await $.ui.panes()
  const isOpen = panes.some(pane => pane.id === PANE && pane.isPlaced)
  await update($, paneOpenAtom, () => isOpen)
}

/**
 * Writes the session's plan and saves it for the project. Every session on
 * the machine shares the store, so a newer approval is never written over.
 */
async function save(
  $: EngineInterface,
  change: (plan: Plan | null) => Plan | null
): Promise<Plan | null> {
  const plan = await update($, planAtom, change)
  if (plan !== null) {
    const stored = await storedPlan($, plan.root)
    if (stored === null || stored.approvedAt <= plan.approvedAt) {
      await $.store.set(storeKey(plan.root), plan)
    }
  }
  return plan
}

/** The session's plan with the progress other sessions saved for the same approval. */
async function withSaved($: EngineInterface, plan: Plan): Promise<Plan> {
  const stored = await storedPlan($, plan.root)
  if (stored === null || stored.approvedAt !== plan.approvedAt) return plan
  return {
    ...plan,
    steps: plan.steps.map(step => stored.steps.find(one => one.n === step.n) ?? step),
    taskIds: { ...stored.taskIds, ...plan.taskIds },
  }
}

/** Applies status changes, then toasts what was newly checked off. */
async function mark($: EngineInterface, changes: readonly Change[]): Promise<Plan | null> {
  const current = await read($, planAtom)
  if (current === null) return current
  const base = await withSaved($, current)
  const wanted = changes.filter(change =>
    base.steps.some(step => step.n === change.n && step.status !== change.status)
  )
  if (wanted.length === 0 && base === current) return current

  const plan = await save($, latest =>
    latest === null || latest.approvedAt !== base.approvedAt
      ? latest
      : {
          ...base,
          knownBy: latest.knownBy,
          steps: base.steps.map(step => {
            const change = wanted.find(one => one.n === step.n)
            return change ? { ...step, status: change.status } : step
          }),
        }
  )
  if (plan === null) return plan

  const checked = wanted.filter(change => change.status === 'completed')
  const total = plan.steps.length
  if (isDone(plan) && !isDone(base)) {
    // The band shows the finish until the next prompt.
    await update($, doneSeenAtom, () => false)
    $.ui.toast(`Plan complete ✔ all ${total} steps of "${plan.title}"`, { timeoutMs: 8000 })
  } else if (checked.length === 1) {
    const step = plan.steps.find(one => one.n === checked[0]?.n)
    $.ui.toast(`✔ ${step?.n}. ${step?.title} (${doneCount(plan)}/${total})`)
  } else if (checked.length > 1) {
    $.ui.toast(`✔ ${checked.length} steps checked off (${doneCount(plan)}/${total})`)
  }
  return plan
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'plan-progress',
      description: 'Show or hide the approved plan’s full checklist (clear stops tracking it)',
      argumentHint: '[clear]',
    })
    await $.tool.register({
      name: TOOL,
      description:
        'Updates the checklist of the approved plan that the person watches above the prompt and in the plan-progress pane. Call it with status "completed" as soon as a step is done, or "skipped" for a step the person drops. The first unfinished step counts as in progress, so use "in_progress" only when you start a step out of order. Steps are numbered as in the checklist plan-progress gave you when the plan was approved.',
      inputSchema: {
        type: 'object',
        properties: {
          step: { type: 'integer', minimum: 1, description: 'The step number from the checklist.' },
          status: { type: 'string', enum: STATUSES, description: 'The step’s new status.' },
        },
        required: ['step', 'status'],
        additionalProperties: false,
      },
    })

    // A restored plan shows in the band; the pane waits until it's asked for.
    await restorePlan($)
    // A reload can find the pane still up.
    await syncPane($)

    return next(e)
  })

  // /clear, /resume and /branch reset `$.state` and fire no session.start.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await restorePlan($, e.source)
    await syncPane($)

    return next(e)
  })

  // The approval: split the plan, track it, and hand the model its steps.
  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined || ran.deny !== undefined || ran.isError === true) return ran
    const output = ran.result
    if (output.awaitingLeaderApproval === true) return ran
    const planText =
      output.plan ?? (output.filePath === undefined ? null : await $.fs.read(output.filePath))
    if (typeof planText !== 'string' || planText.trim() === '') return ran

    const split = await splitPlan($, planText, next.signal)
    const steps = split.steps.slice(0, MAX_STEPS).map((title, i): PlanStep => ({
      n: i + 1,
      title,
      status: 'pending',
    }))
    const root = await $.session.root()
    const knownBy = await $.session.id()
    const plan = await save($, () => ({
      title: split.title || 'Approved plan',
      steps,
      approvedAt: Date.now(),
      root,
      knownBy,
      splitBy: split.splitBy,
      taskIds: {},
    }))
    if (plan === null) return ran
    // The band above the prompt shows the new plan at once, at any width.
    await update($, doneSeenAtom, () => false)

    return { ...ran, context: [...(ran.context ?? []), announce(plan)] }
  }).catch(($, e, next) => next(e))

  // The tool the model checks steps off with.
  on('tool.call', { tool: TOOL_NAME }, async ($, e) => {
    // The schema is the model's to follow, so the values are checked anyway.
    const { step, status }: { step: unknown; status: unknown } = e
    const plan = await read($, planAtom)
    if (plan === null) {
      return { result: 'No approved plan is being tracked, so there is no step to update.', isError: true }
    }
    if (typeof step !== 'number' || !plan.steps.some(one => one.n === step)) {
      return {
        result: `There is no step ${String(step)}: the plan has steps 1 to ${plan.steps.length}.`,
        isError: true,
      }
    }
    if (!isStatus(status)) {
      return { result: `status must be one of ${STATUSES.join(', ')}.`, isError: true }
    }
    const after = (await mark($, [{ n: step, status }])) ?? plan
    const title = after.steps.find(one => one.n === step)?.title ?? ''
    return { result: updateResult(step, status, title, progressLine(after)) }
  }).catch(() => ({ result: 'plan-progress could not update the checklist.', isError: true }))

  // Its own tool updates nothing but its checklist: no prompt for it, and its
  // schema stays in the tool list so the model needs no ToolSearch first.
  on('tool.check', { tool: TOOL_NAME }, () => ({
    decision: 'allow',
    reason: 'plan-progress only updates its own checklist',
  }))
  on('tool.describe', { tool: TOOL_NAME }, async ($, e, next) => ({
    ...(await next(e)),
    isDeferred: false,
  }))

  // Mirrors of the model's own task lists, matched to steps by title.
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    const plan = await read($, planAtom)
    if (plan === null || ran.deny !== undefined || ran.isError === true) return ran
    await mark(
      $,
      e.todos.flatMap(todo => {
        const step = stepFor(plan, todo.content)
        return step ? [{ n: step.n, status: todo.status }] : []
      })
    )
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const plan = await read($, planAtom)
    if (plan === null || ran.deny !== undefined || ran.isError === true) return ran
    const step = stepFor(plan, e.subject)
    const id = ran.result.task.id
    if (step !== undefined) {
      await save($, current => current && { ...current, taskIds: { ...current.taskIds, [id]: step.n } })
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    const plan = await read($, planAtom)
    if (plan === null || ran.deny !== undefined || ran.isError === true) return ran
    const n =
      plan.taskIds[e.taskId] ?? (e.subject === undefined ? undefined : stepFor(plan, e.subject)?.n)
    if (n !== undefined && isStatus(e.status)) await mark($, [{ n, status: e.status }])
    return ran
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'plan-progress' }, async ($, e) => {
    if (e.args.trim() === 'clear') {
      const plan = await read($, planAtom)
      if (plan === null) return { text: 'No plan was being tracked.' }
      await update($, planAtom, () => null)
      // Leave a newer plan that another session approved in this project.
      const stored = await storedPlan($, plan.root)
      if (stored !== null && stored.approvedAt <= plan.approvedAt) {
        await $.store.delete(storeKey(plan.root))
      }
      await $.ui.close({ id: PANE })
      return { text: `Stopped tracking "${plan.title}".` }
    }

    // The keyboard's way to close the pane from the prompt.
    if (await read($, paneOpenAtom)) {
      await $.ui.close({ id: PANE })
      return { text: 'Closed the checklist.' }
    }

    await openPane($)
    const plan = await read($, planAtom)
    if (plan === null) {
      return { text: 'No approved plan yet. Approve one in plan mode and its steps show up here.' }
    }
    const summary = `${plan.title}: ${doneCount(plan)}/${plan.steps.length} steps done.`
    const sessionId = await $.session.id()
    if (plan.knownBy === sessionId || isDone(plan)) return { text: summary }

    // A plan picked up from another session: hand the model its steps too.
    const known = await save($, current => current && { ...current, knownBy: sessionId })
    return {
      text: `${summary} Claude has the checklist again and can carry on with it.`,
      context: [announce(known ?? plan)],
    }
  })

  // The pane closing, by the person or by the plugin, brings the band back.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    await update($, paneOpenAtom, () => false)
    return closed
  }).catch(($, e, next) => next(e))

  // The first prompt after the plan's finish quiets the band.
  on('prompt.submit', async ($, e, next) => {
    const plan = await read($, planAtom)
    if (plan !== null && isDone(plan)) await update($, doneSeenAtom, () => true)
    return next(e)
  }).catch(($, e, next) => next(e))

  // The band above the prompt: progress at a glance, the full list a press away.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const plan = await read($, planAtom)
    if (plan === null || e.props.hasSurvey || (await read($, paneOpenAtom))) return next(e)
    // A plan this session's model hasn't been given waits for /plan-progress.
    const isKnown = plan.knownBy === (await $.session.id())
    const step = currentStep(plan)
    if (step === undefined && (!isKnown || (await read($, doneSeenAtom)))) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    // What the mods after this one draw stays in the band, under the plan.
    const theirs = await next(e)
    const width = Math.min(e.props.bodyColumns, CARD_MAX_WIDTH)
    const total = plan.steps.length
    const count = `${doneCount(plan)}/${total}`

    // Every row starts with a label in a narrow column, so the eye can scan down it.
    const planLabel = (
      <Box width={LABEL_WIDTH} flexShrink={0}>
        <Text bold color="planMode">
          PLAN
        </Text>
      </Box>
    )
    const label = (text: string) => (
      <Box width={LABEL_WIDTH} flexShrink={0}>
        <Text dimColor>{text}</Text>
      </Box>
    )

    let rows
    if (step === undefined) {
      rows = (
        <Box flexDirection="row">
          {planLabel}
          <Box flexShrink={1}>
            <Text color="success" wrap="truncate-end">{`✔ ${plan.title}: all ${total} steps done`}</Text>
          </Box>
        </Box>
      )
    } else if (!isKnown) {
      rows = (
        <Box flexDirection="row">
          {planLabel}
          <Box flexShrink={1}>
            <Text dimColor wrap="truncate-end">
              {`Unfinished: "${plan.title}" ${count} · /plan-progress to resume`}
            </Text>
          </Box>
        </Box>
      )
    } else {
      const after = plan.steps.find(one => one.n > step.n && !isClosed(one.status))
      const barWidth = Math.max(8, Math.min(20, Math.floor(width / 6)))
      const filled = Math.round((doneCount(plan) / Math.max(1, total)) * barWidth)
      rows = (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" columnGap={3}>
            <Box flexDirection="row" flexShrink={1}>
              {planLabel}
              <Box flexShrink={1}>
                <Text bold wrap="truncate-end">
                  {plan.title}
                </Text>
              </Box>
            </Box>
            <Box flexDirection="row" flexShrink={0} columnGap={3}>
              <Box flexDirection="row">
                <Text color="planMode">{'▰'.repeat(filled)}</Text>
                <Text dimColor>{'▱'.repeat(barWidth - filled)}</Text>
                <Text>{` ${count}`}</Text>
              </Box>
              <Button key="all-steps" label="all steps" hotkey="a" plain onPress={() => openPane($)} />
            </Box>
          </Box>
          <Box flexDirection="row">
            {label('Now')}
            <Text color={ICON_COLOR[step.status]}>{`${ICON[step.status]} `}</Text>
            <Box flexShrink={1}>
              <Text bold wrap="truncate-end">{`${step.n}. ${step.title}`}</Text>
            </Box>
          </Box>
          {after !== undefined && (
            <Box flexDirection="row">
              {label('Next')}
              <Text>{'  '}</Text>
              <Box flexShrink={1}>
                <Text dimColor wrap="truncate-end">{`${after.n}. ${after.title}`}</Text>
              </Box>
            </Box>
          )}
        </Box>
      )
    }

    // A thin frame in the plan-mode color sets the plan apart from the transcript.
    return (
      <Box flexDirection="column">
        <Box
          flexDirection="column"
          width={width}
          borderStyle="round"
          borderColor="planMode"
          borderDimColor
          paddingX={1}
        >
          {rows}
        </Box>
        {theirs}
      </Box>
    )
  })

  // In the transcript, each call of the mod's own tool is one dim line, like
  // `✔ plan 15/18 · Install the plugin`, in place of the call and its result.
  on('ui.render', { component: 'ToolUse', props: { tool: TOOL_NAME } }, async ($, e, next) => {
    const { step, status } = (e.props.input ?? {}) as { step?: unknown; status?: unknown }
    // Claude Code draws an error or an interruption in full.
    if (e.props.isErrored || e.props.isInterrupted || typeof step !== 'number' || !isStatus(status)) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)
    const parsed = typeof e.props.output === 'string' ? readUpdateResult(e.props.output) : undefined
    const line = parsed === undefined ? `plan · step ${step}` : `plan ${parsed.count} · ${parsed.title}`
    return (
      <Box flexDirection="row">
        <Text color={ICON_COLOR[status]}>{`${ICON[status]} `}</Text>
        <Box flexShrink={1}>
          <Text dimColor wrap="truncate-end">
            {line}
          </Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'ToolResult', props: { tool: TOOL_NAME } }, async ($, e, next) => {
    if (e.props.isErrored) return next(e)
    const { Box } = $.ui.resolve(e)
    // The row above says it all; the model still reads the full result.
    return <Box />
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const plan = await read($, planAtom)
    if (plan === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No plan yet. Approve a plan in plan mode and its steps show up here.</Text>
          <Box marginTop={1}>
            <Text dimColor>Esc or /plan-progress closes this</Text>
          </Box>
        </Box>
      )
    }

    const total = plan.steps.length
    const done = doneCount(plan)
    const isFinished = done === total
    const count = ` ${done}/${total}`
    const barWidth = Math.max(4, Math.min(30, e.props.bodyColumns - count.length))
    const filled = Math.round((done / Math.max(1, total)) * barWidth)

    // Long plans show a window that starts just above the first open step.
    const room = Math.max(3, (e.viewport?.rows ?? 40) - 9)
    const firstOpen = plan.steps.findIndex(step => !isClosed(step.status))
    const start = Math.max(0, Math.min((firstOpen < 0 ? total : firstOpen) - 1, total - room))
    const shown = plan.steps.slice(start, start + room)
    const below = total - start - shown.length

    return (
      <Box flexDirection="column">
        <Text bold color={isFinished ? 'success' : 'text'} wrap="truncate-end">
          {isFinished ? `✔ ${plan.title}` : plan.title}
        </Text>
        <Box flexDirection="row" marginBottom={1}>
          <Text color="planMode">{'▰'.repeat(filled)}</Text>
          <Text dimColor>{'▱'.repeat(barWidth - filled)}</Text>
          <Text bold={isFinished}>{count}</Text>
        </Box>
        {start > 0 && <Text dimColor>{`  ↑ ${start} more done`}</Text>}
        {shown.map(step => (
          <Box flexDirection="row">
            <Text color={ICON_COLOR[step.status]}>{`${ICON[step.status]} `}</Text>
            <Text
              wrap="truncate-end"
              bold={step.status === 'in_progress'}
              dimColor={isClosed(step.status)}
              strikethrough={step.status === 'skipped'}
            >
              {`${step.n}. ${step.title}`}
            </Text>
          </Box>
        ))}
        {below > 0 && <Text dimColor>{`  ↓ ${below} more`}</Text>}
        {plan.splitBy === 'parser' && (
          <Text dimColor>(split from the plan's own list: the model call failed)</Text>
        )}
        <Box marginTop={1}>
          <Text dimColor>Esc or /plan-progress closes this</Text>
        </Box>
      </Box>
    )
  })
}
