export type EditTool = 'Edit' | 'Write' | 'NotebookEdit'

export type Remark = {
  id: number
  at: number
  tool: EditTool
  file: string
  outcome: 'ok' | 'failed' | 'denied'
  status: 'pending' | 'said' | 'censored' | 'error'
  text: string
}

export type Tally = { edits: number; failures: number; files: string[] }

declare module 'claude-code' {
  interface PluginState {
    'rival-ai': { remarks: Shaped<Remark[]>; tally: Shaped<Tally> }
  }
}
