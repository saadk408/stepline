import { describe, expect, test } from 'claude-code/testing'

import { cleanTitle, parsePlan, parseSplit, readUpdateResult, stepFor, updateResult } from '../hooks/plan'
import type { Plan } from '../types'

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
})
