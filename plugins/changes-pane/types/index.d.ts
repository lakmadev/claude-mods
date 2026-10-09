export type Change = { path: string; added: number; removed: number; edits: number }

declare module 'claude-code' {
  interface PluginState {
    'changes-pane': { files: Change[] }
  }
}
