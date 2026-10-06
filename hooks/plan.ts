// Turning an approved plan's text into steps, and matching titles to them:
// plain functions with no `$`, so tests can call them directly.

import type { Aside, Plan, PlanStep, StepStatus } from '../types'

export type Split = { title: string; steps: string[] }

export const cleanTitle = (text: string) =>
  text
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .replace(/:$/, '')
    .trim()
    .slice(0, 120)

/** A step title as matched against TodoWrite and Task subjects. */
export const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/^\s*(step\s*)?\d+\s*[.):-]\s*/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

export function stepFor(plan: Plan, title: string): PlanStep | undefined {
  const key = normalize(title)
  return key === '' ? undefined : plan.steps.find(step => normalize(step.title) === key)
}

export const SPLIT_SYSTEM =
  'You turn an approved software implementation plan into a checklist. You reply with one JSON object and nothing else.'

export function splitPrompt(planText: string): string {
  return [
    'Split the approved plan below into an ordered checklist of 3 to 12 steps that an engineer will carry out and check off one at a time.',
    '- Each step is one concrete action with a visible outcome ("Add the field to the serializer", "Write tests for the endpoint"), in the order the work happens.',
    '- Step titles are imperative, under 80 characters, with no numbering and no markdown.',
    '- Leave out background, rationale, risks and open questions. Keep verification (tests, lint, manual checks) as its own step when the plan asks for it.',
    '- "title" names the whole plan in under 60 characters.',
    'Reply with exactly: {"title": "...", "steps": ["...", "..."]}',
    '',
    '<plan>',
    planText,
    '</plan>',
  ].join('\n')
}

/** Reads the model's reply: the first `{` to the last `}`, so prose around it is fine. */
export function parseSplit(text: string): Split | undefined {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let data: unknown
  try {
    data = JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
  if (typeof data !== 'object' || data === null) return undefined
  const { title, steps } = data as { title?: unknown; steps?: unknown }
  if (!Array.isArray(steps)) return undefined
  const titles = steps
    .filter((step): step is string => typeof step === 'string')
    .map(cleanTitle)
    .filter(step => step !== '')
  if (titles.length === 0) return undefined
  return { title: typeof title === 'string' ? cleanTitle(title) : '', steps: titles }
}

const NOT_A_STEP =
  /^(context|summary|overview|background|goals?|notes?|risks?|open questions|out of scope|non-goals|critical files|files( to (change|modify|touch))?)\b/i

/** The fallback when the model call fails: the plan's own list, else its headings. */
export function parsePlan(planText: string): Split {
  const lines = planText.split('\n')
  const heading = lines.find(line => /^#\s+\S/.test(line))
  const title = heading === undefined ? '' : cleanTitle(heading.replace(/^#\s+/, ''))

  const items = lines.flatMap(line => {
    const match = /^(\s*)(?:\d+[.)]|[-*]\s+\[[ xX]\])\s+(.+)$/.exec(line)
    return match ? [{ indent: (match[1] ?? '').length, text: match[2] ?? '' }] : []
  })
  if (items.length >= 2) {
    const indent = Math.min(...items.map(item => item.indent))
    return {
      title,
      steps: items.filter(item => item.indent === indent).map(item => cleanTitle(item.text)),
    }
  }

  const headings = lines.flatMap(line => {
    const text = /^#{2,4}\s+(.+)$/.exec(line)?.[1]
    return text === undefined || NOT_A_STEP.test(text) ? [] : [cleanTitle(text)]
  })
  if (headings.length >= 2) return { title, steps: headings }

  return { title, steps: ['Carry out the approved plan'] }
}

/**
 * The result of update_step, which the model reads and each transcript row
 * reads back: the step's title and the count as of that call, so a row for an
 * earlier plan never takes a title from the current one.
 */
export function updateResult(n: number, status: StepStatus, title: string, progress: string): string {
  return `Step ${n} is ${status.replace('_', ' ')}: ${title}. ${progress}`
}

/** The title and `done/total` count an `updateResult` text carries. */
export function readUpdateResult(text: string): { title: string; count: string } | undefined {
  const match = /^Step \d+ is [a-z ]+: (.*)\. (?:All \d+ steps are done \()?(\d+\/\d+) done/.exec(text)
  return match ? { title: match[1] ?? '', count: match[2] ?? '' } : undefined
}

// Steps and their statuses

export const isClosed = (status: StepStatus) => status === 'completed' || status === 'skipped'
export const isDone = (plan: Plan) => plan.steps.every(step => isClosed(step.status))

/** The title of a plan whose split names none; it says nothing about the plan. */
export const FALLBACK_TITLE = 'Approved plan'

/**
 * Whether a newly approved split revises the plan being tracked, and for each
 * new step, the step of that plan it carries on from. A finished plan is never
 * revised: the next piece of work's "Write tests" would come back checked off.
 */
export function carryOver(current: Plan | null, split: Split): { isRevision: boolean; from: (PlanStep | undefined)[] } {
  const fresh = { isRevision: false, from: split.steps.map(() => undefined) }
  if (current === null || isDone(current)) return fresh
  const from = split.steps.map(title => stepFor(current, title))
  const matched = from.filter(step => step !== undefined).length
  if (matched === 0) return fresh
  const title = normalize(split.title)
  const isSameTitle = title !== '' && title !== normalize(FALLBACK_TITLE) && title === normalize(current.title)
  return isSameTitle || matched * 2 >= split.steps.length ? { isRevision: true, from } : fresh
}

/** The Task ids of a revised plan's steps, keyed to the steps that carry them on. */
export function carryTaskIds(
  taskIds: Record<string, number>,
  from: readonly (PlanStep | undefined)[],
  count: number
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(taskIds).flatMap(([id, n]) => {
      const i = from.findIndex(step => step?.n === n)
      return i < 0 || i >= count ? [] : [[id, i + 1]]
    })
  )
}

/**
 * The aside after a TodoWrite: the item under way that is no step, else none
 * when the aside came from an earlier list, else the one the model set itself.
 */
export function todoAside(aside: Aside | null, off: string | undefined): Aside | null {
  if (off !== undefined && off !== '') return { text: off, source: 'todo' }
  return aside?.source === 'todo' ? null : aside
}

/**
 * The session's steps with those another session saved for the same approval:
 * the union by number, each title from the side amended later, and each status
 * as the store has it, so the other session's check-off counts.
 */
export function mergeSteps(mine: Plan, stored: Plan): PlanStep[] {
  const isMineNewer = (mine.amendedAt ?? 0) > (stored.amendedAt ?? 0)
  const numbers = [...new Set([...mine.steps, ...stored.steps].map(step => step.n))].sort((a, b) => a - b)
  return numbers.flatMap(n => {
    const own = mine.steps.find(step => step.n === n)
    const theirs = stored.steps.find(step => step.n === n)
    if (own === undefined || theirs === undefined) return own ?? theirs ?? []
    return [{ ...(isMineNewer ? own : theirs), status: theirs.status }]
  })
}
