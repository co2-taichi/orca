import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { resolveTerminalTabIdForPtyId } from './terminal-tab-for-pty-id'
import { activateWorkspaceTabPaletteResult } from './workspace-tab-palette-activation'
import { focusTerminalInitiatedTab } from '@/hooks/ipc-events/terminal-command-state'
import { activateTerminalTabOnOwner } from './terminal-tab-owner-activation'
import { runtimeEnvironmentIdOrLocalUnlessTwin } from './worktree-runtime-owner'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import type { WorkspacePort } from '../../../shared/workspace-ports'

type LogTargetState = Pick<
  AppState,
  'tabsByWorktree' | 'terminalLayoutsByTabId' | 'ptyIdsByTabId' | 'unifiedTabsByWorktree'
>

export function resolveWorkspacePortLogTarget(state: LogTargetState, port: WorkspacePort) {
  if (port.kind !== 'workspace' || !port.sourcePtyId) {
    return null
  }
  const worktreeId = port.owner.worktreeId
  const tabId = resolveTerminalTabIdForPtyId(state, worktreeId, port.sourcePtyId)
  if (!tabId) {
    return null
  }
  const tab = state.unifiedTabsByWorktree[worktreeId]?.find(
    (candidate) => candidate.contentType === 'terminal' && candidate.entityId === tabId
  )
  if (!tab) {
    return null
  }
  const leafId =
    Object.entries(state.terminalLayoutsByTabId[tabId]?.ptyIdsByLeafId ?? {}).find(
      ([, ptyId]) => ptyId === port.sourcePtyId
    )?.[0] ?? null
  return { ...tab, contentType: 'terminal' as const, leafId }
}

export function openWorkspacePortLogs(
  port: WorkspacePort,
  runtimeTarget: RuntimeClientTarget | null
): boolean {
  if (!runtimeTarget || port.kind !== 'workspace') {
    return false
  }
  const state = useAppStore.getState()
  const environmentId = runtimeEnvironmentIdOrLocalUnlessTwin(state, port.owner.worktreeId)
  if (
    environmentId !== (runtimeTarget.kind === 'environment' ? runtimeTarget.environmentId : null)
  ) {
    return false
  }
  const target = resolveWorkspacePortLogTarget(state, port)
  if (!target) {
    return false
  }
  const result = activateWorkspaceTabPaletteResult({ ...target, tabId: target.id })
  if (result.status !== 'activated') {
    return false
  }
  activateTerminalTabOnOwner(target.worktreeId, target.entityId, target.leafId)
  focusTerminalInitiatedTab(target.entityId, target.leafId, target.worktreeId)
  return true
}
