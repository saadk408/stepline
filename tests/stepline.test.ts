import { describe, expect, test } from 'claude-code/testing'
import type { Engine, Plugin } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Plan } from '../types'

const PLAN_TEXT = [
  '# Add a health check endpoint',
  '',
  '## Context',
  'Load balancers need a cheap endpoint to poll.',
  '',
  '## Steps',
  '1. Add the HealthSerializer',
  '2. Add the GET /health endpoint',
  '3. Write endpoint tests',
].join('\n')

const SPLIT = JSON.stringify({
  title: 'Health check endpoint',
  steps: ['Add the HealthSerializer', 'Add the GET /health endpoint', 'Write endpoint tests'],
})

const USAGE = {
  input_tokens: 1,
  output_tokens: 1,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

const UPDATE = 'mcp__stepline__update_step'
const AMEND = 'mcp__stepline__amend_plan'
const KEY = 'plan:/repo'
const COMMAND = {
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
} as const

type World = {
  store: Map<string, unknown>
  toasts: string[]
  statuses: (string | undefined)[]
  opened: string[]
  /** What each `$.ui.open` asked for, beyond the id. */
  openedWith: object[]
  closed: string[]
}

/** The engine beneath the plugin: a session in /repo whose plan is approved. */
function world(
  on: On,
  options: {
    modelText?: string
    sessionId?: string
    store?: Record<string, unknown>
    isRejected?: boolean
    isModelDenied?: boolean
    isStoreBroken?: boolean
  } = {}
): World {
  const seen: World = {
    store: new Map(Object.entries(options.store ?? {})),
    toasts: [],
    statuses: [],
    opened: [],
    openedWith: [],
    closed: [],
  }
  on('store.get', ($, e) => {
    if (options.isStoreBroken === true) throw new Error('the store could not be read')
    return { value: seen.store.get(e.key) }
  })
  on('store.set', ($, e) => ({ value: void seen.store.set(e.key, e.value) }))
  on('store.delete', ($, e) => ({ value: void seen.store.delete(e.key) }))
  on('store.keys', () => ({ value: [...seen.store.keys()] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('session.root', () => ({ value: '/repo' }))
  on('session.id', () => ({ value: options.sessionId ?? 'session-a' }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__stepline__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', ($, e) => ({ value: void seen.toasts.push(e.text) }))
  on('ui.status', ($, e) => ({ value: void seen.statuses.push(e.text) }))
  on('ui.open', ($, e) => {
    seen.opened.push(e.id)
    seen.openedWith.push({ ...e })
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => ({ value: void seen.closed.push(e.id) }))
  on('ui.panes', () => ({ value: [] }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  // Stand for Claude Code's own tool rows.
  on('ui.render', { component: 'ToolUse' }, () => ({ type: 'Text', props: {}, children: ['engine row'] }))
  on('ui.render', { component: 'ToolResult' }, () => ({ type: 'Text', props: {}, children: ['engine result'] }))
  // Stands for what other mods and Claude Code draw in the band.
  on('ui.render', { component: 'AbovePrompt' }, () => ({
    type: 'Text',
    props: {},
    children: ['drawn by others'],
  }))
  on('model.complete', () =>
    options.isModelDenied === true
      ? { deny: 'the model is blocked by policy' }
      : {
          value:
            options.modelText === undefined
              ? { isAnswered: false, reason: 'empty-reply', usage: USAGE }
              : { isAnswered: true, text: options.modelText, usage: USAGE },
        }
  )
  on('tool.call', { tool: 'ExitPlanMode' }, () =>
    options.isRejected === true
      ? { result: 'The user doesn’t want to proceed with this plan.', isError: true }
      : { result: { plan: PLAN_TEXT, isAgent: false } }
  )
  return seen
}

async function start($: Engine) {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
}

/** The plan as the plugin last saved it for /repo. */
const saved = (seen: World) => seen.store.get(KEY) as Plan | undefined

function pane($: Engine, surface: 'terminal' | 'desktop', rows = 40) {
  return $.ui.mount({
    plugin: 'stepline',
    surface,
    component: 'Pane',
    requestId: 'stepline',
    viewport: { columns: 120, rows },
    props: {
      title: 'Plan',
      isFocused: false,
      bodyColumns: 50,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
  })
}

function band($: Engine, surface: 'terminal' | 'desktop', hasSurvey = false, bodyColumns = 70) {
  return $.ui.mount({
    plugin: 'stepline',
    surface,
    component: 'AbovePrompt',
    props: {
      hasSurvey,
      isWorking: false,
      maxRows: 10,
      bodyColumns,
      scroll: { offset: 0, bodyRows: 9 },
      view: {},
    },
  })
}

describe('approving a plan', () => {
  test('splits it with the model and hands the model its steps, leaving the pane shut', async ($, on) => {
    const seen = world(on, { modelText: `Here you go: ${SPLIT}` })
    await start($)

    const approved = await $.tool.call({ tool: 'ExitPlanMode' })

    expect(approved.context?.at(-1)).toContain('1. [ ] Add the HealthSerializer')
    expect(approved.context?.at(-1)).toContain(UPDATE)
    // One call per step: in progress only for a step started out of order.
    expect(approved.context?.at(-1)).toContain('{"step": N, "status": "completed"} as soon as step N is done')
    expect(approved.context?.at(-1)).toContain('"in_progress" only when you start a step out of order')
    expect(seen.opened).toEqual([])
    // Progress shows in the band, never as a status line.
    expect(seen.statuses).toEqual([])
    const tracked = saved(seen)
    expect(tracked?.title).toBe('Health check endpoint')
    expect(tracked?.splitBy).toBe('model')
    expect(tracked?.steps.map(step => step.status)).toEqual(['pending', 'pending', 'pending'])
  })

  test('falls back to the plan’s own numbered list when the model call fails', async ($, on) => {
    const seen = world(on)
    await start($)

    await $.tool.call({ tool: 'ExitPlanMode' })

    const tracked = saved(seen)
    expect(tracked?.splitBy).toBe('parser')
    expect(tracked?.title).toBe('Add a health check endpoint')
    expect(tracked?.steps.map(step => step.title)).toEqual([
      'Add the HealthSerializer',
      'Add the GET /health endpoint',
      'Write endpoint tests',
    ])
  })

  test('falls back to the plan’s own list when the model call is refused', async ($, on) => {
    const seen = world(on, { isModelDenied: true })
    await start($)

    const approved = await $.tool.call({ tool: 'ExitPlanMode' })

    expect(saved(seen)?.splitBy).toBe('parser')
    expect(saved(seen)?.steps.map(step => step.title)).toEqual([
      'Add the HealthSerializer',
      'Add the GET /health endpoint',
      'Write endpoint tests',
    ])
    expect(approved.context?.at(-1)).toContain('1. [ ] Add the HealthSerializer')
  })

  test('tracks nothing when the person rejects the plan', async ($, on) => {
    const seen = world(on, { modelText: SPLIT, isRejected: true })
    await start($)

    const rejected = await $.tool.call({ tool: 'ExitPlanMode' })

    expect(rejected.context ?? []).toEqual([])
    expect(saved(seen)).toBeUndefined()
  })
})

describe('checking steps off', () => {
  test('TaskCreate and TaskUpdate check off the step their task is titled after', async ($, on) => {
    const seen = world(on, { modelText: SPLIT })
    on('tool.call', { tool: 'TaskCreate' }, ($, e) => ({
      result: { task: { id: e.subject.startsWith('Add the GET') ? 'task-7' : 'task-8', subject: e.subject } },
    }))
    on('tool.call', { tool: 'TaskUpdate' }, ($, e) => ({
      result: { success: true, taskId: e.taskId, updatedFields: ['status'] },
    }))
    await start($)
    await $.tool.call({ tool: 'ExitPlanMode' })

    await $.tool.call({ tool: 'TaskCreate', subject: 'Add the GET /health endpoint', description: 'The route' })
    await $.tool.call({ tool: 'TaskCreate', subject: 'Tidy the imports', description: 'Not a step' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: 'task-7', status: 'completed' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: 'task-8', status: 'completed' })

    expect(saved(seen)?.taskIds).toEqual({ 'task-7': 2 })
    expect(saved(seen)?.steps.map(step => step.status)).toEqual(['pending', 'completed', 'pending'])
  })

  test('update_step checks steps off, toasts each one and the finish', async ($, on) => {
    const seen = world(on, { modelText: SPLIT })
    await start($)
    await $.tool.call({ tool: 'ExitPlanMode' })

    await $.tool.call({ tool: UPDATE, step: 1, status: 'in_progress' })
    const first = await $.tool.call({ tool: UPDATE, step: 1, status: 'completed' })

    expect(String(first.result)).toBe(
      'Step 1 is completed: Add the HealthSerializer. 1/3 done. Next open step: 2. Add the GET /health endpoint'
    )
    expect(seen.toasts.at(-1)).toBe('✔ 1. Add the HealthSerializer (1/3)')
    expect(saved(seen)?.steps.map(step => step.status)).toEqual(['completed', 'pending', 'pending'])

    await $.tool.call({ tool: UPDATE, step: 2, status: 'completed' })
    await $.tool.call({ tool: UPDATE, step: 3, status: 'skipped' })

    expect(seen.toasts.at(-1)).toContain('Plan complete')
    expect(saved(seen)?.steps.map(step => step.status)).toEqual(['completed', 'completed', 'skipped'])
  })

  test('update_step refuses a step the plan does not have', async ($, on) => {
    const seen = world(on, { modelText: SPLIT })
    await start($)
    await $.tool.call({ tool: 'ExitPlanMode' })

    const wrong = await $.tool.call({ tool: UPDATE, step: 9, status: 'completed' })

    expect(wrong.isError).toBe(true)
    expect(saved(seen)?.steps.every(step => step.status === 'pending')).toBe(true)
  })

  test('TodoWrite items titled like a step check it off too', async ($, on) => {
    const seen = world(on, { modelText: SPLIT })
    on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }))
    await start($)
    await $.tool.call({ tool: 'ExitPlanMode' })

    await $.tool.call({
      tool: 'TodoWrite',
      todos: [
        { content: '1. Add the HealthSerializer', status: 'completed', activeForm: 'Adding' },
        { content: 'Add the GET /health endpoint', status: 'in_progress', activeForm: 'Adding' },
        { content: 'Something unrelated', status: 'completed', activeForm: 'Doing' },
      ],
    })

    expect(saved(seen)?.steps.map(step => step.status)).toEqual([
      'completed',
      'in_progress',
      'pending',
    ])
  })
})

describe('what the README discloses', () => {
  test('leaves its own tools, like every other, to the session’s permission rules', async ($, on) => {
    world(on)
    on('tool.check', () => ({ decision: 'ask', reason: 'the session’s rules' }))

    const own = await $.tool.check({ tool: UPDATE, input: { step: 1, status: 'completed' } })
    const amend = await $.tool.check({ tool: AMEND, input: { action: 'add', title: 'x' } })
    const other = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' } })

    expect(own).toEqual({ decision: 'ask', reason: 'the session’s rules' })
    expect(amend).toEqual({ decision: 'ask', reason: 'the session’s rules' })
    expect(other).toEqual({ decision: 'ask', reason: 'the session’s rules' })
  })

  test('keeps its tool loaded up front, so Claude needs no ToolSearch first', async ($, on) => {
    world(on)
    on('tool.describe', ($, e) => ({ description: e.description, isDeferred: true }))

    const described = await $.tool.describe({
      tool: UPDATE,
      description: 'Updates the checklist',
      provider: { plugin: 'stepline', tier: 'user' },
    })

    expect(described).toEqual({ description: 'Updates the checklist', isDeferred: false })
  })
})

describe('the pane', () => {
  test('draws a progress bar and a row per step on each surface', async ($, on) => {
    world(on, { modelText: SPLIT })
    await start($)
    await $.tool.call({ tool: 'ExitPlanMode' })
    await $.tool.call({ tool: UPDATE, step: 1, status: 'completed' })
    await $.tool.call({ tool: UPDATE, step: 2, status: 'in_progress' })

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await pane($, surface)
      expect(await ui.find({ type: 'Text', text: 'Health check endpoint' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: ' 1/3' })).toBeDefined()
      const current = await ui.find({ type: 'Text', text: '2. Add the GET /health endpoint' })
      expect(current?.props.bold).toBe(true)
      const done = await ui.find({ type: 'Text', text: '1. Add the HealthSerializer' })
      expect(done?.props.dimColor).toBe(true)
      expect(await ui.find({ type: 'Text', text: 'Esc or /stepline closes this' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('shows a long plan from just above its first open step', async ($, on) => {
    const titles = ['Plan', 'Model', 'Serializer', 'Endpoint', 'Tests', 'Docs', 'Lint', 'Release']
    const long: Plan = {
      title: 'A long plan',
      steps: titles.map((title, i) => ({ n: i + 1, title, status: i < 4 ? 'completed' : 'pending' })),
      approvedAt: 0,
      root: '/repo',
      knownBy: 'session-a',
      splitBy: 'model',
      taskIds: {},
    }
    world(on, { store: { [KEY]: long } })
    await start($)

    // 12 rows leave room for three steps under the title, bar and footer.
    const ui = await pane($, 'terminal', 12)
    expect(await ui.find({ type: 'Text', text: '  ↑ 3 more done' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '4. Endpoint' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '6. Docs' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '  ↓ 2 more' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1. Plan' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '8. Release' })).toBeUndefined()
    await ui.unmount()
  })

  test('says how to get a plan when none is tracked', async ($, on) => {
    world(on)
    await start($)

    const ui = await pane($, 'terminal')
    expect(await ui.find({ type: 'Text', text: /No plan yet/ })).toBeDefined()
    await ui.unmount()
  })
})

/** Another mod that draws in the band, after this one in the order mods run in. */
const neighbor: Plugin = {
  name: 'band-neighbor',
  tier: 'append',
  register(on) {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return Text({ children: ['a neighbor’s line'] })
    })
  },
}

/**
 * A mod above this one that reads how its SessionStart hook settled. It runs
 * apart from the test, names nothing from this file, and hands what it read
 * over through the store, under `watcher:outcomes`.
 */
const watcher: Plugin = {
  name: 'outcome-watcher',
  tier: 'prepend',
  register(on) {
    on('classic.SessionStart', async ($, e, next) => {
      const result = await next(e)
      const links = next.trace.filter(link => link.plugin === 'stepline')
      await $.store.set('watcher:outcomes', links.map(link => link.outcome))
      return result
    })
  },
}

function toolRow(
  $: Engine,
  surface: 'terminal' | 'desktop',
  props: { tool?: string; input?: unknown; output?: unknown; isErrored?: boolean; isInterrupted?: boolean }
) {
  return $.ui.mount({
    plugin: 'stepline',
    surface,
    component: 'ToolUse',
    requestId: 'call-1',
    props: {
      tool_use_id: 'call-1',
      tool: props.tool ?? UPDATE,
      input: props.input ?? { step: 1, status: 'completed' },
      isRunning: false,
      isErrored: props.isErrored ?? false,
      isInterrupted: props.isInterrupted ?? false,
      output: props.output,
    },
  })
}

describe('the transcript', () => {
  test('draws each update_step call as one dim line on each surface', async ($, on) => {
    world(on, { modelText: SPLIT })
    await start($)
    await $.tool.call({ tool: 'ExitPlanMode' })
    const done = await $.tool.call({ tool: UPDATE, step: 1, status: 'completed' })

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await toolRow($, surface, { output: done.result })
      expect(await ui.find({ type: 'Text', text: '✔ ' })).toBeDefined()
      const line = await ui.find({ type: 'Text', text: 'plan 1/3 · Add the HealthSerializer' })
      expect(line?.props.dimColor).toBe(true)
      expect(await ui.find({ type: 'Text', text: 'engine row' })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('keeps a row for an earlier plan as it was, whatever plan is tracked now', async ($, on) => {
    world(on, { modelText: SPLIT })
    await start($)
    await $.tool.call({ tool: 'ExitPlanMode' })

    const ui = await toolRow($, 'terminal', {
      input: { step: 2, status: 'skipped' },
      output: 'Step 2 is skipped: Migrate the old table. 2/5 done. Next open step: 3. Drop it',
    })
    expect(await ui.find({ type: 'Text', text: '⊘ ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'plan 2/5 · Migrate the old table' })).toBeDefined()
    await ui.unmount()
  })

  test('leaves errors, interruptions and other tools’ rows to Claude Code', async ($, on) => {
    world(on)

    for (const props of [{ isErrored: true }, { isInterrupted: true }, { tool: 'Bash', input: { command: 'ls' } }]) {
      const ui = await toolRow($, 'terminal', props)
      expect(await ui.find({ type: 'Text', text: 'engine row' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('hides the result block under its own row, but not an error or another tool’s', async ($, on) => {
    world(on)
    const result = (tool: string, isErrored: boolean) =>
      $.ui.mount({
        plugin: 'stepline',
        surface: 'terminal',
        component: 'ToolResult',
        requestId: 'call-1',
        props: { tool_use_id: 'call-1', tool, output: 'Step 1 is completed: x. 1/3 done.', isErrored },
      })

    const own = await result(UPDATE, false)
    expect(await own.findAll({ type: 'Text' })).toEqual([])
    await own.unmount()
    for (const [tool, isErrored] of [[UPDATE, true], ['Bash', false]] as const) {
      const ui = await result(tool, isErrored)
      expect(await ui.find({ type: 'Text', text: 'engine result' })).toBeDefined()
      await ui.unmount()
    }
  })
})

describe('the band', () => {
  test('keeps what a real second mod draws there, under the plan', { plugins: [neighbor] }, async ($, on) => {
    world(on, { modelText: SPLIT })
    await start($)
    await $.tool.call({ tool: 'ExitPlanMode' })

    const ui = await band($, 'terminal')
    expect(await ui.find({ type: 'Text', text: 'Health check endpoint' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'a neighbor’s line' })).toBeDefined()
    await ui.unmount()
  })

  test('shows the plan in a card on each surface, above what others draw', async ($, on) => {
    world(on, { modelText: SPLIT })
    await start($)
    await $.tool.call({ tool: 'ExitPlanMode' })
    await $.tool.call({ tool: UPDATE, step: 1, status: 'completed' })
    await $.tool.call({ tool: UPDATE, step: 2, status: 'in_progress' })

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await band($, surface)
      expect(await ui.find({ type: 'Text', text: 'Health check endpoint' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: ' 1/3' })).toBeDefined()
      const current = await ui.find({ type: 'Text', text: '2. Add the GET /health endpoint' })
      expect(current?.props.bold).toBe(true)
      const next = await ui.find({ type: 'Text', text: '3. Write endpoint tests' })
      expect(next?.props.dimColor).toBe(true)
      expect(await ui.find({ type: 'Button', key: 'all-steps' })).toBeDefined()
      const frame = (await ui.findAll({ type: 'Box' })).find(box => box.props.borderStyle === 'round')
      expect(frame?.props).toMatchObject({ borderColor: 'planMode', width: 70 })
      // The labels, then the rest of the band under the card.
      const texts = (await ui.findAll({ type: 'Text' })).map(text => text.text)
      for (const label of ['PLAN', 'Now', 'Next', 'drawn by others']) expect(texts).toContain(label)
      expect(texts.indexOf('drawn by others')).toBeGreaterThan(texts.indexOf('PLAN'))
      await ui.unmount()
    }
  })

  test('stops widening at 120 columns, keeping the bar near the title', async ($, on) => {
    world(on, { modelText: SPLIT })
    await start($)
    await $.tool.call({ tool: 'ExitPlanMode' })

    const ui = await band($, 'terminal', false, 200)
    const frame = (await ui.findAll({ type: 'Box' })).find(box => box.props.borderStyle === 'round')
    expect(frame?.props.width).toBe(120)
    expect(await ui.find({ type: 'Text', text: '▱'.repeat(20) })).toBeDefined()
    await ui.unmount()
  })

  test('gives way to a survey', async ($, on) => {
    world(on, { modelText: SPLIT })
    await start($)
    await $.tool.call({ tool: 'ExitPlanMode' })

    const ui = await band($, 'terminal', true)
    expect(await ui.find({ type: 'Text', text: 'Health check endpoint' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'drawn by others' })).toBeDefined()
    await ui.unmount()
  })

  test('All steps opens the pane, and the band steps aside until the pane closes', async ($, on) => {
    const seen = world(on, { modelText: SPLIT })
    await start($)
    await $.tool.call({ tool: 'ExitPlanMode' })
    const ui = await band($, 'terminal')

    await ui.press({ key: 'all-steps' })

    expect(seen.opened).toEqual(['stepline'])
    expect(seen.openedWith[0]).toMatchObject({ focus: true, closeOnEscape: true })
    expect(await ui.find({ type: 'Text', text: 'Health check endpoint' })).toBeUndefined()
    await ui.unmount()

    // The mod closes its own pane on clear; the next plan is in the band again.
    await $.command.run({ command: 'stepline', args: 'clear', ...COMMAND })
    await $.tool.call({ tool: 'ExitPlanMode' })

    const after = await band($, 'terminal')
    expect(await after.find({ type: 'Text', text: 'Health check endpoint' })).toBeDefined()
    await after.unmount()
  })

  test('a finished plan shows its ✔ line until the next prompt', async ($, on) => {
    world(on, { modelText: SPLIT })
    await start($)
    await $.tool.call({ tool: 'ExitPlanMode' })
    for (const step of [1, 2, 3]) await $.tool.call({ tool: UPDATE, step, status: 'completed' })

    const ui = await band($, 'terminal')
    expect(await ui.find({ type: 'Text', text: '✔ Health check endpoint: all 3 steps done' })).toBeDefined()
    await ui.unmount()

    await $.turn.start({ text: 'Thanks!', turnId: 'turn-1' })

    const after = await band($, 'terminal')
    expect(await after.find({ type: 'Text', text: /all 3 steps done/ })).toBeUndefined()
    expect(await after.find({ type: 'Text', text: 'drawn by others' })).toBeDefined()
    await after.unmount()
  })
})

describe('across sessions', () => {
  const stored: Plan = {
    title: 'Health check endpoint',
    steps: [
      { n: 1, title: 'Add the HealthSerializer', status: 'completed' },
      { n: 2, title: 'Add the GET /health endpoint', status: 'pending' },
    ],
    approvedAt: 0,
    root: '/repo',
    knownBy: 'session-old',
    splitBy: 'model',
    taskIds: {},
  }

  test('a new session in the repo picks the plan back up and /stepline hands it to the model', async ($, on) => {
    const seen = world(on, { sessionId: 'session-new', store: { 'plan:/repo': stored } })
    await start($)

    expect(saved(seen)?.title).toBe('Health check endpoint')
    expect(seen.opened).toEqual([])

    const shown = await $.command.run({ command: 'stepline', args: '', ...COMMAND })
    expect(seen.opened).toEqual(['stepline'])
    expect(shown.text).toContain('1/2 steps done')
    expect(shown.context?.[0]).toContain('2. [ ] Add the GET /health endpoint')

    const closed = await $.command.run({ command: 'stepline', args: '', ...COMMAND })
    expect(closed.text).toBe('Closed the checklist.')
    expect(seen.closed).toEqual(['stepline'])

    const again = await $.command.run({ command: 'stepline', args: '', ...COMMAND })
    expect(seen.opened).toEqual(['stepline', 'stepline'])
    expect(again.context ?? []).toEqual([])
  })

  test('the band shows a plan picked up from another session as one line', async ($, on) => {
    world(on, { sessionId: 'session-new', store: { 'plan:/repo': stored } })
    await start($)

    const ui = await band($, 'terminal')
    expect(
      await ui.find({
        type: 'Text',
        text: 'Unfinished: "Health check endpoint" 1/2 · /stepline to resume',
      })
    ).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'all-steps' })).toBeUndefined()
    await ui.unmount()
  })

  test('/stepline clear stops tracking it', async ($, on) => {
    const seen = world(on, { store: { 'plan:/repo': stored } })
    await start($)

    await $.command.run({ command: 'stepline', args: 'clear', ...COMMAND })

    expect(saved(seen)).toBeUndefined()
    const ui = await band($, 'terminal')
    expect(await ui.find({ type: 'Text', text: 'PLAN' })).toBeUndefined()
    await ui.unmount()
  })

  test('/clear brings the plan back and /stepline hands it to the model again', async ($, on) => {
    // The same session that was told the steps before its context was cleared.
    world(on, { sessionId: 'session-old', store: { 'plan:/repo': stored } })

    // Each test starts with $.state at its defaults, as /clear leaves it.
    await $.classic.SessionStart({ source: 'clear' })

    // Claude's context was cleared, so the band offers the plan back.
    const line = await band($, 'terminal')
    expect(await line.find({ type: 'Text', text: /^Unfinished: "Health check endpoint" 1\/2/ })).toBeDefined()
    await line.unmount()
    const ui = await pane($, 'terminal')
    expect(await ui.find({ type: 'Text', text: '2. Add the GET /health endpoint' })).toBeDefined()
    await ui.unmount()

    const shown = await $.command.run({ command: 'stepline', args: '', ...COMMAND })
    expect(shown.context?.[0]).toContain('2. [ ] Add the GET /health endpoint')
  })

  test('a store that fails at /clear leaves the session start to Claude Code', { plugins: [watcher] }, async ($, on) => {
    const seen = world(on, { isStoreBroken: true })

    const started = await $.classic.SessionStart({ source: 'clear' })

    expect(started).toEqual({})
    // The hook's .catch answered in its place, rather than the engine skipping it.
    expect(seen.store.get('watcher:outcomes')).toEqual(['caught'])
  })

  test('a step another session checked off is kept', async ($, on) => {
    const seen = world(on, { modelText: SPLIT })
    await start($)
    await $.tool.call({ tool: 'ExitPlanMode' })
    const approved = saved(seen) as Plan
    // Another session in /repo checks off step 2 of the same approval.
    seen.store.set(KEY, {
      ...approved,
      steps: approved.steps.map(step => (step.n === 2 ? { ...step, status: 'completed' } : step)),
    })

    await $.tool.call({ tool: UPDATE, step: 1, status: 'completed' })

    expect(saved(seen)?.steps.map(step => step.status)).toEqual(['completed', 'completed', 'pending'])
  })

  test('a newer plan another session approved is never written over', async ($, on) => {
    const seen = world(on, { modelText: SPLIT })
    await start($)
    await $.tool.call({ tool: 'ExitPlanMode' })
    const approved = saved(seen) as Plan
    const newer: Plan = { ...approved, title: 'A newer plan', approvedAt: approved.approvedAt + 1000 }
    seen.store.set(KEY, newer)

    await $.tool.call({ tool: UPDATE, step: 1, status: 'completed' })

    expect(saved(seen)).toEqual(newer)
    // This session still tracks its own plan.
    const ui = await band($, 'terminal')
    expect(await ui.find({ type: 'Text', text: ' 1/3' })).toBeDefined()
    await ui.unmount()

    await $.command.run({ command: 'stepline', args: 'clear', ...COMMAND })

    expect(saved(seen)).toEqual(newer)
  })
})

describe('changing the plan as the work drifts', () => {
  test('add appends a step with the next number, toasts it, and reopens a finished plan', async ($, on) => {
    const seen = world(on, { modelText: SPLIT })
    await start($)
    await $.tool.call({ tool: 'ExitPlanMode' })
    for (const step of [1, 2, 3]) await $.tool.call({ tool: UPDATE, step, status: 'completed' })
    await $.turn.start({ text: 'Thanks!', turnId: 'turn-1' })

    const added = await $.tool.call({ tool: AMEND, action: 'add', title: '**Add** rate limiting' })

    expect(String(added.result)).toBe(
      'Step 4 is pending: Add rate limiting. 3/4 done. Next open step: 4. Add rate limiting'
    )
    expect(seen.toasts.at(-1)).toBe('+ 4. Add rate limiting (3/4)')
    expect(saved(seen)?.steps.at(-1)).toEqual({ n: 4, title: 'Add rate limiting', status: 'pending', isAdded: true })
    expect(typeof saved(seen)?.amendedAt).toBe('number')
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await band($, surface)
      expect(await ui.find({ type: 'Text', text: '4. Add rate limiting' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: ' 3/4' })).toBeDefined()
      await ui.unmount()
      const full = await pane($, surface)
      expect(await full.find({ type: 'Text', text: '4. Add rate limiting +' })).toBeDefined()
      await full.unmount()
    }
  })

  test('add refuses a step number, an empty title, and a 21st step', async ($, on) => {
    world(on, { modelText: SPLIT })
    await start($)
    await $.tool.call({ tool: 'ExitPlanMode' })

    expect((await $.tool.call({ tool: AMEND, action: 'add', step: 4, title: 'Ship it' })).isError).toBe(true)
    expect((await $.tool.call({ tool: AMEND, action: 'add', title: '  ' })).isError).toBe(true)
    for (let i = 4; i <= 20; i++) await $.tool.call({ tool: AMEND, action: 'add', title: `Step ${i}` })
    const full = await $.tool.call({ tool: AMEND, action: 'add', title: 'One too many' })

    expect(full.isError).toBe(true)
    expect(String(full.result)).toBe('The checklist holds at most 20 steps.')
  })

  test('a check-off and an added step in the same turn both land', async ($, on) => {
    const seen = world(on, { modelText: SPLIT })
    await start($)
    await $.tool.call({ tool: 'ExitPlanMode' })

    await Promise.all([
      $.tool.call({ tool: UPDATE, step: 1, status: 'completed' }),
      $.tool.call({ tool: AMEND, action: 'add', title: 'Add rate limiting' }),
      $.tool.call({ tool: UPDATE, step: 2, status: 'completed' }),
    ])

    expect(saved(seen)?.steps.map(step => step.status)).toEqual(['completed', 'completed', 'pending', 'pending'])
    expect(saved(seen)?.steps[3]?.title).toBe('Add rate limiting')
  })

  test('retitle renames a step and keeps its status', async ($, on) => {
    const seen = world(on, { modelText: SPLIT })
    await start($)
    await $.tool.call({ tool: 'ExitPlanMode' })
    await $.tool.call({ tool: UPDATE, step: 2, status: 'in_progress' })

    const renamed = await $.tool.call({ tool: AMEND, action: 'retitle', step: 2, title: 'Add the GET /status endpoint' })

    expect(String(renamed.result)).toBe(
      'Step 2 is in progress: Add the GET /status endpoint. 0/3 done. Next open step: 1. Add the HealthSerializer'
    )
    expect(saved(seen)?.steps[1]).toEqual({ n: 2, title: 'Add the GET /status endpoint', status: 'in_progress' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await band($, surface)
      expect(await ui.find({ type: 'Text', text: '2. Add the GET /status endpoint' })).toBeDefined()
      await ui.unmount()
      const full = await pane($, surface)
      expect(await full.find({ type: 'Text', text: '2. Add the GET /status endpoint' })).toBeDefined()
      await full.unmount()
    }
    expect((await $.tool.call({ tool: AMEND, action: 'retitle', step: 9, title: 'Nope' })).isError).toBe(true)
    expect((await $.tool.call({ tool: AMEND, action: 'retitle', step: 2 })).isError).toBe(true)
  })

  test('an aside shows under Now in place of Next until the next step, prompt, or an empty one', async ($, on) => {
    world(on, { modelText: SPLIT })
    await start($)
    await $.tool.call({ tool: 'ExitPlanMode' })

    const noted = await $.tool.call({ tool: AMEND, action: 'aside', title: 'Fixing the import cycle first' })
    expect(String(noted.result)).toBe('Aside noted: Fixing the import cycle first.')

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await band($, surface)
      expect(await ui.find({ type: 'Text', text: 'Aside' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Fixing the import cycle first' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Next' })).toBeUndefined()
      await ui.unmount()
      const full = await pane($, surface)
      expect(await full.find({ type: 'Text', text: '  ↳ Fixing the import cycle first' })).toBeDefined()
      await full.unmount()
    }

    await $.tool.call({ tool: UPDATE, step: 1, status: 'completed' })
    const stepped = await band($, 'terminal')
    expect(await stepped.find({ type: 'Text', text: 'Aside' })).toBeUndefined()
    expect(await stepped.find({ type: 'Text', text: 'Next' })).toBeDefined()
    await stepped.unmount()

    await $.tool.call({ tool: AMEND, action: 'aside', title: 'Answering a question' })
    await $.turn.start({ text: 'Carry on', turnId: 'turn-2' })
    const prompted = await band($, 'terminal')
    expect(await prompted.find({ type: 'Text', text: 'Aside' })).toBeUndefined()
    await prompted.unmount()

    await $.tool.call({ tool: AMEND, action: 'aside', title: 'Answering a question' })
    const cleared = await $.tool.call({ tool: AMEND, action: 'aside' })
    expect(String(cleared.result)).toBe('Aside cleared.')
    const gone = await band($, 'terminal')
    expect(await gone.find({ type: 'Text', text: 'Aside' })).toBeUndefined()
    await gone.unmount()
  })

  test('an in-progress todo that is no step becomes the aside, until its list drops it', async ($, on) => {
    world(on, { modelText: SPLIT })
    on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }))
    await start($)
    await $.tool.call({ tool: 'ExitPlanMode' })
    const todos = (status: 'in_progress' | 'completed') => [
      { content: 'Add the HealthSerializer', status: 'in_progress' as const, activeForm: 'Adding' },
      { content: 'Fix the `tsc` errors in auth.ts', status, activeForm: 'Fixing' },
    ]

    await $.tool.call({ tool: 'TodoWrite', todos: todos('in_progress') })
    const ui = await band($, 'terminal')
    expect(await ui.find({ type: 'Text', text: 'Fix the tsc errors in auth.ts' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1. Add the HealthSerializer' })).toBeDefined()
    await ui.unmount()

    await $.tool.call({ tool: 'TodoWrite', todos: todos('completed') })
    const done = await band($, 'terminal')
    expect(await done.find({ type: 'Text', text: 'Aside' })).toBeUndefined()
    await done.unmount()

    // One the model set itself outlives its todo list.
    await $.tool.call({ tool: AMEND, action: 'aside', title: 'Answering a question' })
    await $.tool.call({ tool: 'TodoWrite', todos: todos('completed') })
    const kept = await band($, 'terminal')
    expect(await kept.find({ type: 'Text', text: 'Answering a question' })).toBeDefined()
    await kept.unmount()
  })

  test('approving a revised plan carries its finished steps over and tells the model so', async ($, on) => {
    const options = { modelText: SPLIT }
    const seen = world(on, options)
    await start($)
    await $.tool.call({ tool: 'ExitPlanMode' })
    await $.tool.call({ tool: UPDATE, step: 1, status: 'completed' })
    await $.tool.call({ tool: UPDATE, step: 2, status: 'skipped' })
    const first = saved(seen) as Plan

    options.modelText = JSON.stringify({
      title: 'Health check endpoint',
      steps: ['Add the HealthSerializer', 'Add the GET /health endpoint', 'Document the endpoint', 'Write endpoint tests'],
    })
    const approved = await $.tool.call({ tool: 'ExitPlanMode' })

    expect(approved.context?.at(-1)).toContain('This revises the plan approved earlier')
    expect(approved.context?.at(-1)).toContain('1. [x] Add the HealthSerializer')
    expect(approved.context?.at(-1)).toContain('2. [-] Add the GET /health endpoint')
    expect(approved.context?.at(-1)).toContain('3. [ ] Document the endpoint')
    const revised = saved(seen) as Plan
    expect(revised.revisedFrom).toBe(first.approvedAt)
    expect(revised.steps.map(step => step.status)).toEqual(['completed', 'skipped', 'pending', 'pending'])
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await pane($, surface)
      expect(await ui.find({ type: 'Text', text: '(revised from an earlier approval)' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('a different plan replaces the one tracked, and a finished one is never revised', async ($, on) => {
    const options = { modelText: SPLIT }
    const seen = world(on, options)
    await start($)
    await $.tool.call({ tool: 'ExitPlanMode' })
    await $.tool.call({ tool: UPDATE, step: 3, status: 'completed' })

    options.modelText = JSON.stringify({
      title: 'Rate limiting',
      steps: ['Add the limiter', 'Wire it in', 'Write endpoint tests'],
    })
    const other = await $.tool.call({ tool: 'ExitPlanMode' })

    expect(other.context?.at(-1)).not.toContain('This revises')
    expect(saved(seen)?.revisedFrom).toBeUndefined()
    expect(saved(seen)?.steps.map(step => step.status)).toEqual(['pending', 'pending', 'pending'])

    for (const step of [1, 2, 3]) await $.tool.call({ tool: UPDATE, step, status: 'completed' })
    await $.tool.call({ tool: 'ExitPlanMode' })

    expect(saved(seen)?.revisedFrom).toBeUndefined()
    expect(saved(seen)?.steps.map(step => step.status)).toEqual(['pending', 'pending', 'pending'])
  })

  test('a step another session added is accepted, and a plan it revised is offered back', async ($, on) => {
    const seen = world(on, { modelText: SPLIT })
    await start($)
    await $.tool.call({ tool: 'ExitPlanMode' })
    const approved = saved(seen) as Plan
    seen.store.set(KEY, {
      ...approved,
      amendedAt: approved.approvedAt + 1,
      steps: [...approved.steps, { n: 4, title: 'Add rate limiting', status: 'pending', isAdded: true }],
    })

    const fourth = await $.tool.call({ tool: UPDATE, step: 4, status: 'completed' })

    expect(fourth.isError).not.toBe(true)
    expect(saved(seen)?.steps.map(step => step.status)).toEqual(['pending', 'pending', 'pending', 'completed'])
    const ui = await band($, 'terminal')
    expect(await ui.find({ type: 'Text', text: ' 1/4' })).toBeDefined()
    await ui.unmount()

    // Another session approves a revision of this plan.
    const revision: Plan = {
      ...approved,
      title: 'Health check endpoint, revised',
      approvedAt: approved.approvedAt + 1000,
      revisedFrom: approved.approvedAt,
      knownBy: 'session-b',
    }
    seen.store.set(KEY, revision)
    const refused = await $.tool.call({ tool: UPDATE, step: 1, status: 'completed' })

    expect(refused.isError).toBe(true)
    expect(String(refused.result)).toBe(
      'The plan was revised in another session (now "Health check endpoint, revised", 0/3 done). Run /stepline to pick up the new checklist.'
    )
    expect(saved(seen)).toEqual(revision)
    // The refusal holds until /stepline hands the new checklist over.
    expect((await $.tool.call({ tool: UPDATE, step: 1, status: 'completed' })).isError).toBe(true)
    expect((await $.tool.call({ tool: AMEND, action: 'add', title: 'Ship it' })).isError).toBe(true)
    expect(saved(seen)).toEqual(revision)
    const line = await band($, 'terminal')
    expect(
      await line.find({ type: 'Text', text: /^Unfinished: "Health check endpoint, revised" 0\/3/ })
    ).toBeDefined()
    await line.unmount()

    await $.command.run({ command: 'stepline', args: '', ...COMMAND })
    const accepted = await $.tool.call({ tool: UPDATE, step: 1, status: 'completed' })

    expect(accepted.isError).not.toBe(true)
    expect(saved(seen)?.knownBy).toBe('session-a')
    expect(saved(seen)?.steps.map(step => step.status)).toEqual(['completed', 'pending', 'pending'])
  })

  test('keeps amend_plan loaded and draws each call as one dim line', async ($, on) => {
    world(on, { modelText: SPLIT })
    on('tool.describe', ($, e) => ({ description: e.description, isDeferred: true }))
    await start($)
    await $.tool.call({ tool: 'ExitPlanMode' })

    const described = await $.tool.describe({
      tool: AMEND,
      description: 'Changes the checklist',
      provider: { plugin: 'stepline', tier: 'user' },
    })
    expect(described).toEqual({ description: 'Changes the checklist', isDeferred: false })

    const added = await $.tool.call({ tool: AMEND, action: 'add', title: 'Add rate limiting' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await toolRow($, surface, {
        tool: AMEND,
        input: { action: 'add', title: 'Add rate limiting' },
        output: added.result,
      })
      expect(await ui.find({ type: 'Text', text: '+ ' })).toBeDefined()
      const row = await ui.find({ type: 'Text', text: 'plan 0/4 · Add rate limiting' })
      expect(row?.props.dimColor).toBe(true)
      expect(await ui.find({ type: 'Text', text: 'engine row' })).toBeUndefined()
      await ui.unmount()
    }
    const aside = await toolRow($, 'terminal', {
      tool: AMEND,
      input: { action: 'aside', title: 'Fixing the build' },
      output: 'Aside noted: Fixing the build.',
    })
    expect(await aside.find({ type: 'Text', text: '↳ ' })).toBeDefined()
    expect(await aside.find({ type: 'Text', text: 'Fixing the build' })).toBeDefined()
    await aside.unmount()
    const errored = await toolRow($, 'terminal', { tool: AMEND, input: { action: 'add' }, isErrored: true })
    expect(await errored.find({ type: 'Text', text: 'engine row' })).toBeDefined()
    await errored.unmount()
  })
})
