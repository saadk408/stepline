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

const UPDATE = 'mcp__plan-progress__update_step'
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
  on('tool.register', ($, e) => ({ value: { tool: `mcp__plan-progress__${e.name}` } }))
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
  on('prompt.submit', ($, e) => ({ text: e.text }))
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
    plugin: 'plan-progress',
    surface,
    component: 'Pane',
    requestId: 'plan-progress',
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
    plugin: 'plan-progress',
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
  test('approves its own tool and leaves every other tool to the usual check', async ($, on) => {
    world(on)
    on('tool.check', () => ({ decision: 'ask', reason: 'the session’s rules' }))

    const own = await $.tool.check({ tool: UPDATE, input: { step: 1, status: 'completed' } })
    const other = await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' } })

    expect(own.decision).toBe('allow')
    expect(other).toEqual({ decision: 'ask', reason: 'the session’s rules' })
  })

  test('keeps its tool loaded up front, so Claude needs no ToolSearch first', async ($, on) => {
    world(on)
    on('tool.describe', ($, e) => ({ description: e.description, isDeferred: true }))

    const described = await $.tool.describe({
      tool: UPDATE,
      description: 'Updates the checklist',
      provider: { plugin: 'plan-progress', tier: 'user' },
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
      expect(await ui.find({ type: 'Text', text: 'Esc or /plan-progress closes this' })).toBeDefined()
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
      const links = next.trace.filter(link => link.plugin === 'plan-progress')
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
    plugin: 'plan-progress',
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
        plugin: 'plan-progress',
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

    expect(seen.opened).toEqual(['plan-progress'])
    expect(seen.openedWith[0]).toMatchObject({ focus: true, closeOnEscape: true })
    expect(await ui.find({ type: 'Text', text: 'Health check endpoint' })).toBeUndefined()
    await ui.unmount()

    // The mod closes its own pane on clear; the next plan is in the band again.
    await $.command.run({ command: 'plan-progress', args: 'clear', ...COMMAND })
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

    await $.prompt.submit({ text: 'Thanks!', wait: false, origin: { kind: 'composer' } })

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

  test('a new session in the repo picks the plan back up and /plan-progress hands it to the model', async ($, on) => {
    const seen = world(on, { sessionId: 'session-new', store: { 'plan:/repo': stored } })
    await start($)

    expect(saved(seen)?.title).toBe('Health check endpoint')
    expect(seen.opened).toEqual([])

    const shown = await $.command.run({ command: 'plan-progress', args: '', ...COMMAND })
    expect(seen.opened).toEqual(['plan-progress'])
    expect(shown.text).toContain('1/2 steps done')
    expect(shown.context?.[0]).toContain('2. [ ] Add the GET /health endpoint')

    const closed = await $.command.run({ command: 'plan-progress', args: '', ...COMMAND })
    expect(closed.text).toBe('Closed the checklist.')
    expect(seen.closed).toEqual(['plan-progress'])

    const again = await $.command.run({ command: 'plan-progress', args: '', ...COMMAND })
    expect(seen.opened).toEqual(['plan-progress', 'plan-progress'])
    expect(again.context ?? []).toEqual([])
  })

  test('the band shows a plan picked up from another session as one line', async ($, on) => {
    world(on, { sessionId: 'session-new', store: { 'plan:/repo': stored } })
    await start($)

    const ui = await band($, 'terminal')
    expect(
      await ui.find({
        type: 'Text',
        text: 'Unfinished: "Health check endpoint" 1/2 · /plan-progress to resume',
      })
    ).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'all-steps' })).toBeUndefined()
    await ui.unmount()
  })

  test('/plan-progress clear stops tracking it', async ($, on) => {
    const seen = world(on, { store: { 'plan:/repo': stored } })
    await start($)

    await $.command.run({ command: 'plan-progress', args: 'clear', ...COMMAND })

    expect(saved(seen)).toBeUndefined()
    const ui = await band($, 'terminal')
    expect(await ui.find({ type: 'Text', text: 'PLAN' })).toBeUndefined()
    await ui.unmount()
  })

  test('/clear brings the plan back and /plan-progress hands it to the model again', async ($, on) => {
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

    const shown = await $.command.run({ command: 'plan-progress', args: '', ...COMMAND })
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

    await $.command.run({ command: 'plan-progress', args: 'clear', ...COMMAND })

    expect(saved(seen)).toEqual(newer)
  })
})
