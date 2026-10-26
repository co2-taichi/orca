import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceServerLaunch } from './workspace-server-launches'
import { startWorkspaceServer } from './start-workspace-server'

const mocks = vi.hoisted(() => {
  const records: WorkspaceServerLaunch[] = []
  const tabsByWorktree: Record<string, { id: string }[]> = {}
  return {
    records,
    host: vi.fn((): string | null => 'local'),
    environment: vi.fn((): string | null => null),
    scan: vi.fn(),
    activate: vi.fn(() => true),
    save: vi.fn(),
    remote: vi.fn(),
    store: {
      tabsByWorktree,
      createTab: vi.fn(() => ({ id: 'new-tab' })),
      setActiveTabType: vi.fn()
    }
  }
})
vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.store } }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('./worktree-activation', () => ({ activateAndRevealWorkspace: mocks.activate }))
vi.mock('./worktree-runtime-owner', () => ({
  getKnownExecutionHostIdForWorktree: mocks.host,
  runtimeEnvironmentIdOrLocalUnlessTwin: mocks.environment
}))
vi.mock('./workspace-port-actions', () => ({ scanWorkspacePortsForTarget: mocks.scan }))
vi.mock('@/runtime/web-runtime-terminal-create-operation', () => ({
  createWebRuntimeSessionTerminalResult: mocks.remote
}))
vi.mock('./workspace-server-launches', () => ({
  getWorkspaceServerLaunches: () => mocks.records,
  saveWorkspaceServerLaunch: mocks.save
}))

const entry: WorkspaceServerLaunch = {
  id: 'server',
  runtimeTarget: { kind: 'local' },
  executionHostId: 'local',
  worktreeId: 'wt',
  repoId: 'repo',
  name: 'Frontend',
  port: 4008,
  command: 'pnpm dev --port 4008',
  cwd: '/repo/frontend',
  workspacePath: '/repo'
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.records = [{ ...entry }]
  mocks.store.tabsByWorktree = {}
  mocks.host.mockReturnValue('local')
  mocks.environment.mockReturnValue(null)
  mocks.scan.mockResolvedValue({ platform: 'unknown', scannedAt: 1, ports: [] })
})
describe('start a saved server', () => {
  it('executes the registered command in a fresh terminal with its registered directory', async () => {
    await startWorkspaceServer(entry)
    expect(mocks.store.createTab).toHaveBeenCalledWith(
      'wt',
      undefined,
      undefined,
      expect.objectContaining({ pendingStartup: { command: entry.command }, startupCwd: entry.cwd })
    )
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ launchTabId: 'new-tab' }))
  })
  it('refuses an occupied port, including a listener outside this workspace', async () => {
    mocks.scan.mockResolvedValue({ ports: [{ kind: 'external', port: 4008 }] })
    await expect(startWorkspaceServer(entry)).rejects.toThrow('already in use')
    expect(mocks.store.createTab).not.toHaveBeenCalled()
  })
  it('does not start while the existing startup terminal is still pending', async () => {
    const pending = { ...entry, launchTabId: 'pending' }
    mocks.records = [pending]
    mocks.store.tabsByWorktree = { wt: [{ id: 'pending' }] }
    await expect(startWorkspaceServer(entry)).rejects.toThrow('existing startup terminal')
    expect(mocks.scan).not.toHaveBeenCalled()
  })
  it('blocks repeated clicks while the first scan is in flight', async () => {
    let release: (() => void) | undefined
    mocks.scan.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ports: [] })
        })
    )
    const first = startWorkspaceServer(entry)
    await expect(startWorkspaceServer(entry)).rejects.toThrow('already starting')
    release?.()
    await first
    expect(mocks.store.createTab).toHaveBeenCalledTimes(1)
  })
  it('fails closed when scanning is unavailable or the workspace host changed', async () => {
    mocks.scan.mockResolvedValueOnce({ ports: [], unavailableReason: 'Scan unavailable' })
    await expect(startWorkspaceServer(entry)).rejects.toThrow('Scan unavailable')
    mocks.host.mockReturnValue('ssh:other')
    await expect(startWorkspaceServer(entry)).rejects.toThrow('execution host changed')
    expect(mocks.store.createTab).not.toHaveBeenCalled()
  })
  it('does not execute a command that was edited while awaiting the scan', async () => {
    mocks.scan.mockImplementationOnce(async () => {
      mocks.records = [{ ...entry, command: 'other' }]
      return { ports: [] }
    })
    await expect(startWorkspaceServer(entry)).rejects.toThrow('configuration changed')
    expect(mocks.store.createTab).not.toHaveBeenCalled()
  })
  it('uses the paired host terminal creator rather than executing the command locally', async () => {
    const remote: WorkspaceServerLaunch = {
      ...entry,
      runtimeTarget: { kind: 'environment', environmentId: 'host' },
      executionHostId: 'runtime:host'
    }
    mocks.records = [remote]
    mocks.host.mockReturnValue('runtime:host')
    mocks.environment.mockReturnValue('host')
    mocks.remote.mockResolvedValue({ outcome: { status: 'created' }, hostTabId: 'host-tab' })
    await startWorkspaceServer(remote)
    expect(mocks.remote).toHaveBeenCalledWith(
      expect.objectContaining({ environmentId: 'host', command: entry.command, cwd: entry.cwd })
    )
    expect(mocks.store.createTab).not.toHaveBeenCalled()
  })
})
