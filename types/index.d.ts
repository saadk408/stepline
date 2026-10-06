export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped'

export type PlanStep = { n: number; title: string; status: StepStatus }

export type Plan = {
  title: string
  steps: PlanStep[]
  approvedAt: number
  /** The project root the plan was approved in: its key in `$.store`. */
  root: string
  /** The session whose model has been told the steps and the tool. */
  knownBy: string
  /** How the plan was split: by a model call, or by the fallback parser. */
  splitBy: 'model' | 'parser'
  /** TaskCreate ids whose subject matched a step, to mirror TaskUpdate. */
  taskIds: Record<string, number>
}

declare module 'claude-code' {
  interface PluginState {
    'plan-progress': {
      plan: Plan | null
      /** Whether the checklist pane is open, which hides the band. */
      isPaneOpen: boolean
      /** Whether a prompt has followed the plan's finish, which hides the band. */
      isDoneSeen: boolean
    }
  }

  /** The input of the tool the mod registers, so `e.tool` narrows to it. */
  interface McpToolInputs {
    'mcp__plan-progress__update_step': { step: number; status: StepStatus }
  }
}
