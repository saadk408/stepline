import { describe, expect, test } from 'claude-code/testing'

import {
  carryOver,
  carryTaskIds,
  cleanTitle,
  mergeSteps,
  parsePlan,
  parseSplit,
  planLine,
  readUpdateResult,
  stepFor,
  todoAside,
  updateResult,
} from '../hooks/plan'
import type { Plan, PlanStep } from '../types'

describe('parsePlan, the fallback when the model call fails', () => {
  test('takes the top-level numbered list and leaves sub-items out', () => {
    const split = parsePlan(
      [
        '# Add a health check endpoint',
        '',
        '1. Add the HealthSerializer',
        '   1. Include the build version',
        '2. Add the GET /health endpoint',
        '   - Return 503 while migrations run',
        '3. Write endpoint tests',
      ].join('\n')
    )

    expect(split).toEqual({
      title: 'Add a health check endpoint',
      steps: ['Add the HealthSerializer', 'Add the GET /health endpoint', 'Write endpoint tests'],
    })
  })

  test('takes a checkbox list, ticked or not', () => {
    const split = parsePlan(['- [ ] Add the model', '- [x] Wire the endpoint', '* [ ] Ship it'].join('\n'))

    expect(split.steps).toEqual(['Add the model', 'Wire the endpoint', 'Ship it'])
    expect(split.title).toBe('')
  })

  test('falls back to headings, skipping the ones that are background', () => {
    const split = parsePlan(
      [
        '# Health check',
        '## Context',
        'Load balancers need a cheap endpoint to poll.',
        '## Add the model',
        '### Wire the endpoint',
        '## Risks',
        '## Open questions',
        '## Verification',
      ].join('\n')
    )

    expect(split.steps).toEqual(['Add the model', 'Wire the endpoint', 'Verification'])
  })

  test('makes one step of a plan with no list and no headings', () => {
    expect(parsePlan('Just make the tests pass.').steps).toEqual(['Carry out the approved plan'])
  })

  test('cleans markdown out of step titles', () => {
    const split = parsePlan(['1. **Add** the `HealthSerializer`:', '2. Write   endpoint\ttests'].join('\n'))

    expect(split.steps).toEqual(['Add the HealthSerializer', 'Write endpoint tests'])
  })
})

describe('parseSplit, reading the model’s reply', () => {
  test('finds the JSON inside prose around it', () => {
    const split = parseSplit('Sure! Here it is:\n{"title": "Health check", "steps": ["Add the model", "Ship it"]}\nDone.')

    expect(split).toEqual({ title: 'Health check', steps: ['Add the model', 'Ship it'] })
  })

  test('drops steps that are not text or are empty', () => {
    const split = parseSplit('{"title": 7, "steps": ["Add the model", 42, "  ", null, "Ship it"]}')

    expect(split).toEqual({ title: '', steps: ['Add the model', 'Ship it'] })
  })

  test('gives up on a reply it cannot use', () => {
    expect(parseSplit('I could not split this plan.')).toBeUndefined()
    expect(parseSplit('{"title": "Health check", "steps": [')).toBeUndefined()
    expect(parseSplit('{"title": "Health check", "steps": "Add the model"}')).toBeUndefined()
    expect(parseSplit('{"title": "Health check", "steps": []}')).toBeUndefined()
  })
})

describe('stepFor, matching TodoWrite and Task titles to steps', () => {
  const plan: Plan = {
    title: 'Health check',
    steps: [
      { n: 1, title: 'Add the HealthSerializer', status: 'pending' },
      { n: 2, title: 'Add the GET /health endpoint', status: 'pending' },
    ],
    approvedAt: 0,
    root: '/repo',
    knownBy: '',
    splitBy: 'model',
    taskIds: {},
  }

  test('ignores numbering, case and punctuation', () => {
    expect(stepFor(plan, '1. add the healthserializer')?.n).toBe(1)
    expect(stepFor(plan, 'Step 2: Add the GET /health endpoint.')?.n).toBe(2)
    expect(stepFor(plan, '2) Add the GET health endpoint')?.n).toBe(2)
  })

  test('matches nothing for an unrelated or empty title', () => {
    expect(stepFor(plan, 'Update the API docs')).toBeUndefined()
    expect(stepFor(plan, '3.')).toBeUndefined()
  })

  test('cleanTitle caps a title at 120 characters', () => {
    expect(cleanTitle('x'.repeat(200))).toHaveLength(120)
  })
})

describe('updateResult and readUpdateResult, the text a transcript row reads back', () => {
  test('carry the step’s title and the count as of the call', () => {
    const text = updateResult(2, 'completed', 'Add the GET /health endpoint', '2/5 done. Next open step: 3. Write tests')

    expect(text).toBe('Step 2 is completed: Add the GET /health endpoint. 2/5 done. Next open step: 3. Write tests')
    expect(readUpdateResult(text)).toEqual({ title: 'Add the GET /health endpoint', count: '2/5' })
  })

  test('read the last step and a title with a full stop in it', () => {
    const text = updateResult(5, 'skipped', 'Ship v1.2. Then tag it', 'All 5 steps are done (5/5 done).')

    expect(readUpdateResult(text)).toEqual({ title: 'Ship v1.2. Then tag it', count: '5/5' })
  })

  test('read nothing from text they did not write', () => {
    expect(readUpdateResult('No approved plan is being tracked.')).toBeUndefined()
  })

  test('planLine draws the row from the result, or falls back for text they did not write', () => {
    const done = 'Step 2 is completed: Add the endpoint. 2/5 done. Next open step: 3. Write tests'
    expect(planLine(done, 'plan · step 2')).toBe('plan 2/5 · Add the endpoint')
    expect(planLine('No approved plan is being tracked.', 'plan · step 2')).toBe('plan · step 2')
    expect(planLine(undefined, 'plan · step 2')).toBe('plan · step 2')
  })
})

describe('carryOver, whether a new approval revises the plan being tracked', () => {
  const tracked: Plan = {
    title: 'Health check endpoint',
    steps: [
      { n: 1, title: 'Add the HealthSerializer', status: 'completed' },
      { n: 2, title: 'Add the GET /health endpoint', status: 'skipped' },
      { n: 3, title: 'Write endpoint tests', status: 'pending' },
    ],
    approvedAt: 0,
    root: '/repo',
    knownBy: '',
    splitBy: 'model',
    taskIds: {},
  }

  test('carries each status over by title when the title is the same', () => {
    const carried = carryOver(tracked, {
      title: 'Health check endpoint',
      steps: ['Add the HealthSerializer', 'Document the endpoint', 'Write endpoint tests'],
    })

    expect(carried.isRevision).toBe(true)
    expect(carried.from.map(step => step?.status)).toEqual(['completed', undefined, 'pending'])
  })

  test('is a revision under a new title when at least half the steps match', () => {
    const carried = carryOver(tracked, {
      title: 'Health check, take two',
      steps: ['1. Add the HealthSerializer', 'Add the GET /health endpoint', 'Deploy it'],
    })

    expect(carried.isRevision).toBe(true)
    expect(carried.from.map(step => step?.n)).toEqual([1, 2, undefined])
  })

  test('is a fresh plan when fewer than half match under a new title', () => {
    const carried = carryOver(tracked, {
      title: 'Rate limiting',
      steps: ['Add the limiter', 'Wire it in', 'Write endpoint tests'],
    })

    expect(carried.isRevision).toBe(false)
    expect(carried.from).toEqual([undefined, undefined, undefined])
  })

  test('never revises a finished plan, one with no plan, or by the fallback title alone', () => {
    const finished: Plan = { ...tracked, steps: tracked.steps.map(step => ({ ...step, status: 'completed' })) }
    expect(carryOver(finished, { title: 'Health check endpoint', steps: ['Write endpoint tests', 'Ship it'] }).isRevision).toBe(false)
    expect(carryOver(null, { title: 'Health check endpoint', steps: ['Write endpoint tests'] }).isRevision).toBe(false)

    const untitled: Plan = { ...tracked, title: 'Approved plan' }
    expect(carryOver(untitled, { title: 'Approved plan', steps: ['Write endpoint tests', 'Ship it', 'Tag it'] }).isRevision).toBe(false)
    expect(carryOver(untitled, { title: '', steps: ['Write endpoint tests', 'Ship it', 'Tag it'] }).isRevision).toBe(false)
  })
})

describe('mergeSteps, the session’s steps with another session’s', () => {
  const plan = (steps: PlanStep[], amendedAt?: number): Plan => ({
    title: 'Health check',
    steps,
    approvedAt: 0,
    root: '/repo',
    knownBy: '',
    splitBy: 'model',
    taskIds: {},
    ...(amendedAt === undefined ? {} : { amendedAt }),
  })

  test('keeps a step either side added, and takes each status from the store', () => {
    const mine = plan([
      { n: 1, title: 'Add the model', status: 'completed' },
      { n: 2, title: 'Add the endpoint', status: 'pending' },
    ])
    const stored = plan(
      [
        { n: 1, title: 'Add the model', status: 'pending' },
        { n: 2, title: 'Add the endpoint', status: 'completed' },
        { n: 3, title: 'Write tests', status: 'pending', isAdded: true },
      ],
      5
    )

    expect(mergeSteps(mine, stored)).toEqual([
      { n: 1, title: 'Add the model', status: 'pending' },
      { n: 2, title: 'Add the endpoint', status: 'completed' },
      { n: 3, title: 'Write tests', status: 'pending', isAdded: true },
    ])
    expect(mergeSteps(stored, mine).map(step => step.n)).toEqual([1, 2, 3])
  })

  test('takes a title from the side amended later', () => {
    const mine = plan([{ n: 1, title: 'Use Redis for the cache', status: 'pending' }], 9)
    const stored = plan([{ n: 1, title: 'Use Postgres for the cache', status: 'in_progress' }], 5)

    expect(mergeSteps(mine, stored)).toEqual([{ n: 1, title: 'Use Redis for the cache', status: 'in_progress' }])
    expect(mergeSteps(plan(mine.steps, 4), stored)).toEqual([
      { n: 1, title: 'Use Postgres for the cache', status: 'in_progress' },
    ])
  })
})

describe('carryTaskIds, the Task ids a revision keeps', () => {
  const from = [
    undefined,
    { n: 3, title: 'Write tests', status: 'pending' as const },
    { n: 1, title: 'Add the model', status: 'completed' as const },
  ]

  test('keys each id to the new step that carries its old one on', () => {
    expect(carryTaskIds({ 'task-7': 3, 'task-8': 1, 'task-9': 2 }, from, 3)).toEqual({ 'task-7': 2, 'task-8': 3 })
  })

  test('drops an id whose step fell past the step limit', () => {
    expect(carryTaskIds({ 'task-8': 1 }, from, 2)).toEqual({})
  })
})

describe('todoAside, the aside after a todo list', () => {
  test('takes an item under way, drops a list’s aside, and keeps the model’s own', () => {
    expect(todoAside(null, 'Fix the build')).toEqual({ text: 'Fix the build', source: 'todo' })
    expect(todoAside({ text: 'Old', source: 'todo' }, undefined)).toBeNull()
    expect(todoAside({ text: 'Mine', source: 'tool' }, undefined)).toEqual({ text: 'Mine', source: 'tool' })
    expect(todoAside({ text: 'Mine', source: 'tool' }, '')).toEqual({ text: 'Mine', source: 'tool' })
  })
})
