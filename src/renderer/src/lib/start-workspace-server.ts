import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { activateAndRevealWorkspace } from './worktree-activation'
import {
  getKnownExecutionHostIdForWorktree,
  runtimeEnvironmentIdOrLocalUnlessTwin
} from './worktree-runtime-owner'
import { scanWorkspacePortsForTarget } from './workspace-port-actions'
import { createWebRuntimeSessionTerminalResult } from '@/runtime/web-runtime-terminal-create-operation'
import { toWebTerminalSurfaceTabId } from '../../../shared/terminal-surface-id'
import {
  saveWorkspaceServerLaunch,
  getWorkspaceServerLaunches,
  type WorkspaceServerLaunch
} from './workspace-server-launches'

const starting = new Set<string>()

export async function startWorkspaceServer(entry: WorkspaceServerLaunch): Promise<void> {
  if (starting.has(entry.id)) {
    throw new Error(
      translate(
        'auto.components.right.sidebar.index.serverAlreadyStarting',
        'This server is already starting.'
      )
    )
  }
  starting.add(entry.id)
  try {
    const state = useAppStore.getState()
    const current = getWorkspaceServerLaunches().find((item) => item.id === entry.id)
    if (!current || current.command !== entry.command || current.cwd !== entry.cwd) {
      throw new Error(
        translate(
          'auto.components.right.sidebar.index.serverConfigChanged',
          'The server configuration changed. Try again.'
        )
      )
    }
    const host = getKnownExecutionHostIdForWorktree(state, entry.worktreeId)
    const environmentId = runtimeEnvironmentIdOrLocalUnlessTwin(state, entry.worktreeId)
    if (
      host !== entry.executionHostId ||
      environmentId !==
        (entry.runtimeTarget.kind === 'environment' ? entry.runtimeTarget.environmentId : null)
    ) {
      throw new Error(
        translate(
          'auto.components.right.sidebar.index.serverHostChanged',
          'The workspace execution host changed. Configure this server again.'
        )
      )
    }
    if (
      current.launchTabId &&
      (!state.tabsByWorktree[entry.worktreeId] ||
        state.tabsByWorktree[entry.worktreeId]?.some((tab) => tab.id === current.launchTabId))
    ) {
      throw new Error(
        translate(
          'auto.components.right.sidebar.index.serverCheckStartupTerminal',
          'Check the existing startup terminal. Close it before trying again if startup failed.'
        )
      )
    }
    const scan = await scanWorkspacePortsForTarget(entry.runtimeTarget)
    if (scan.unavailableReason) {
      throw new Error(scan.unavailableReason)
    }
    if (scan.ports.some((port) => port.port === entry.port)) {
      throw new Error(
        translate(
          'auto.components.right.sidebar.index.serverPortConflict',
          'Port {{port}} is already in use.',
          { port: entry.port }
        )
      )
    }
    const latestConfig = getWorkspaceServerLaunches().find((item) => item.id === entry.id)
    if (!latestConfig || latestConfig.command !== entry.command || latestConfig.cwd !== entry.cwd) {
      throw new Error(
        translate(
          'auto.components.right.sidebar.index.serverConfigChanged',
          'The server configuration changed. Try again.'
        )
      )
    }
    const latest = useAppStore.getState()
    if (
      getKnownExecutionHostIdForWorktree(latest, entry.worktreeId) !== host ||
      runtimeEnvironmentIdOrLocalUnlessTwin(latest, entry.worktreeId) !== environmentId
    ) {
      throw new Error(
        translate(
          'auto.components.right.sidebar.index.serverHostChanged',
          'The workspace execution host changed. Configure this server again.'
        )
      )
    }
    if (
      !activateAndRevealWorkspace(entry.worktreeId, {
        executionHostId: host,
        providesInitialSurface: true
      })
    ) {
      throw new Error(
        translate(
          'auto.components.right.sidebar.index.serverWorkspaceUnavailable',
          'Could not open the workspace.'
        )
      )
    }
    let tabId: string
    if (entry.runtimeTarget.kind === 'environment') {
      const created = await createWebRuntimeSessionTerminalResult({
        worktreeId: entry.worktreeId,
        environmentId: entry.runtimeTarget.environmentId,
        command: entry.command,
        cwd: entry.cwd,
        activate: true,
        viewMode: 'terminal'
      })
      if (created.outcome.status !== 'created' || !created.hostTabId) {
        throw new Error(
          created.outcome.status === 'failed'
            ? created.outcome.message
            : translate(
                'auto.components.right.sidebar.index.serverTerminalUnavailable',
                'Could not create the startup terminal.'
              )
        )
      }
      tabId = toWebTerminalSurfaceTabId(created.hostTabId)
    } else {
      const store = useAppStore.getState()
      tabId = store.createTab(entry.worktreeId, undefined, undefined, {
        pendingStartup: { command: entry.command },
        startupCwd: entry.cwd,
        quickCommandLabel: entry.name,
        viewMode: 'terminal'
      }).id
      store.setActiveTabType('terminal', entry.worktreeId)
    }
    saveWorkspaceServerLaunch({ ...entry, launchTabId: tabId })
  } finally {
    starting.delete(entry.id)
  }
}
