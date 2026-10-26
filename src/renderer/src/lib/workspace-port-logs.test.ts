import { describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store/types'
import type { WorkspacePort } from '../../../shared/workspace-ports'
import { resolveWorkspacePortLogTarget } from './workspace-port-logs'

vi.mock('@/store', () => ({ useAppStore: {} }))
vi.mock('./workspace-tab-palette-activation', () => ({
  activateWorkspaceTabPaletteResult: vi.fn()
}))
vi.mock('@/hooks/ipc-events/terminal-command-state', () => ({ focusTerminalInitiatedTab: vi.fn() }))
vi.mock('./terminal-tab-owner-activation', () => ({ activateTerminalTabOnOwner: vi.fn() }))
vi.mock('./worktree-runtime-owner', () => ({ runtimeEnvironmentIdOrLocalUnlessTwin: vi.fn() }))

type State = Pick<
  AppState,
  'tabsByWorktree' | 'terminalLayoutsByTabId' | 'ptyIdsByTabId' | 'unifiedTabsByWorktree'
>
const port: WorkspacePort = {
  id: 'port',
  bindHost: '127.0.0.1',
  connectHost: 'localhost',
  port: 4008,
  protocol: 'http',
  kind: 'workspace',
  sourcePtyId: 'pty-split',
  owner: { worktreeId: 'wt', repoId: 'repo', path: '/repo', displayName: 'main', confidence: 'cwd' }
}
function state(): State {
  return {
    tabsByWorktree: {
      wt: [
        {
          id: 'terminal',
          ptyId: 'pty-root',
          worktreeId: 'wt',
          title: 'Server',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 0
        }
      ]
    },
    terminalLayoutsByTabId: {
      terminal: {
        root: { type: 'leaf', leafId: 'logs' },
        activeLeafId: 'logs',
        expandedLeafId: null,
        ptyIdsByLeafId: { logs: 'pty-split' }
      }
    },
    ptyIdsByTabId: {},
    unifiedTabsByWorktree: {
      wt: [
        {
          id: 'unified',
          entityId: 'terminal',
          worktreeId: 'wt',
          groupId: 'group',
          contentType: 'terminal',
          label: 'Server',
          customLabel: null,
          color: null,
          sortOrder: 0,
          createdAt: 0
        }
      ]
    }
  }
}
describe('server log navigation', () => {
  it('resolves the exact split pane rather than another terminal in the workspace', () => {
    expect(resolveWorkspacePortLogTarget(state(), port)).toMatchObject({
      id: 'unified',
      entityId: 'terminal',
      leafId: 'logs'
    })
  })
  it('refuses closed or foreign workspace terminals', () => {
    const closed = state()
    closed.tabsByWorktree = {}
    expect(resolveWorkspacePortLogTarget(closed, port)).toBeNull()
    expect(
      resolveWorkspacePortLogTarget(state(), {
        ...port,
        owner: { ...port.owner, worktreeId: 'other' }
      })
    ).toBeNull()
  })
  it('does not invent log sources for older servers or external processes', () => {
    expect(resolveWorkspacePortLogTarget(state(), { ...port, sourcePtyId: undefined })).toBeNull()
    expect(
      resolveWorkspacePortLogTarget(state(), {
        id: 'external',
        bindHost: '*',
        connectHost: 'localhost',
        port: 80,
        protocol: 'http',
        kind: 'external'
      })
    ).toBeNull()
  })
})
