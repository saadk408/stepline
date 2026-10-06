export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped'

export type PlanStep = {
  n: number
  title: string
  status: StepStatus
  /** Set on a step added after the approval, which the pane marks. */
  isAdded?: true
}

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
  /** When a step was last added or retitled; absent until one is. */
  amendedAt?: number
  /** The `approvedAt` of the plan this one revised. */
  revisedFrom?: number
}

/** A few words on unplanned work under way, shown under the current step. */
export type Aside = {
  text: string
  /** Who set it: the model through amend_plan, or an in-progress todo. */
  source: 'tool' | 'todo'
}

export type AmendAction = 'add' | 'retitle' | 'aside'

declare module 'claude-code' {
  interface PluginState {
    stepline: {
      plan: Plan | null
      /** Whether the checklist pane is open, which hides the band. */
      isPaneOpen: boolean
      /** Whether a prompt has followed the plan's finish, which hides the band. */
      isDoneSeen: boolean
      /** What the model is doing off the plan, until its next step or prompt. */
      aside: Aside | null
    }
  }

  /** The inputs of the tools the mod registers, so `e.tool` narrows to them. */
  interface McpToolInputs {
    'mcp__stepline__update_step': { step: number; status: StepStatus }
    'mcp__stepline__amend_plan': { action: AmendAction; step?: number; title?: string }
  }
}
