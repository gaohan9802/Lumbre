/**
 * Compatibility exports for older imports.
 * Tool execution is intentionally exposed only through the permission executor.
 */
export { ALL_TOOLS, FETCH_TOOL_NAMES, toolsForContext } from './agent/registry'
export { executeTool, executeToolBatch, resolveAndExecuteToolConfirmation } from './agent/executor'
export type { ToolCallResult } from './agent/executor'
export type { ToolDef } from './agent/types'
export { getUserContext, updateUserContext } from './agent/tools/user-context'
