export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
// The main conversation's last API call: when it ended and the context it sent.
export type Cache = { at: number; tokens?: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-limits': { limits: Limit[]; cache: Cache | null }
  }
}
