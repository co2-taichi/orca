import { afterEach, expect, it, vi } from 'vitest'
import {
  killAllProcessesForWorktree,
  type WorktreeTeardownRuntime
} from '../runtime/worktree-teardown'
import { WorkspaceServerProcessManager } from './workspace-server-process-manager'
import type { IPtyProvider, PtyProcessInfo } from '../providers/pty-provider-contract'
const { listRegisteredPtysMock } = vi.hoisted(() => ({ listRegisteredPtysMock: vi.fn(() => []) }))
vi.mock('../memory/pty-registry', () => ({ listRegisteredPtys: listRegisteredPtysMock }))
function createProviderStub(listProcesses: () => Promise<PtyProcessInfo[]>): IPtyProvider {
  return {
    spawn: vi.fn(),
    attach: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    sendSignal: vi.fn(),
    getCwd: vi.fn(),
    getInitialCwd: vi.fn(),
    clearBuffer: vi.fn(),
    acknowledgeDataEvent: vi.fn(),
    hasChildProcesses: vi.fn(),
    getForegroundProcess: vi.fn(),
    serialize: vi.fn(),
    revive: vi.fn(),
    listProcesses: vi.fn(listProcesses),
    getDefaultShell: vi.fn(),
    getProfiles: vi.fn(),
    onData: vi.fn().mockReturnValue(() => {}),
    onReplay: vi.fn().mockReturnValue(() => {}),
    onExit: vi.fn().mockReturnValue(() => {})
  } as unknown as IPtyProvider
}

it('stops managed servers before a destructive sweep but skips reconciliation and off-host twins', async () => {
  listRegisteredPtysMock.mockReturnValue([])
  const stopWorktree = vi.fn(async () => {})
  const runtime = {
    workspaceServers: { stopWorktree },
    stopTerminalsForWorktree: vi.fn(async () => ({ stopped: 0 }))
  } as unknown as WorktreeTeardownRuntime
  const localProvider = createProviderStub(async () => [])
  await killAllProcessesForWorktree('w', { runtime, localProvider })
  await killAllProcessesForWorktree('w', {
    runtime,
    localProvider,
    resolvedWorktreeId: 'w',
    resolvedConnectionId: 'remote',
    closeStructuredSessions: true
  })
  expect(stopWorktree).not.toHaveBeenCalled()
  await killAllProcessesForWorktree('w', {
    runtime,
    localProvider,
    resolvedWorktreeId: 'w',
    closeStructuredSessions: true
  })
  expect(stopWorktree).toHaveBeenCalledExactlyOnceWith('w')
  stopWorktree.mockRejectedValueOnce(new Error('server termination unverified'))
  await expect(
    killAllProcessesForWorktree('w', { runtime, localProvider, requirePhysicalStop: true })
  ).rejects.toThrow('server termination unverified')
})

afterEach(() => vi.useRealTimers())

function failingServerSweep() {
  const manager = new WorkspaceServerProcessManager()
  const stopWorktree = vi.spyOn(manager, 'stopWorktree')
  const stopTerminalsForWorktree = vi.fn(async () => ({ stopped: 0 }))
  const runtime: WorktreeTeardownRuntime = {
    workspaceServers: manager,
    stopTerminalsForWorktree,
    getPtyLivenessVerdict: () => ({ status: 'exited' }),
    forgetStructuredSessionMail: vi.fn(),
    retireStructuredAgentSessionTabFromSnapshot: vi.fn(() => false)
  }
  return {
    runtime,
    stopWorktree,
    stopTerminalsForWorktree,
    localProvider: createProviderStub(async () => [])
  }
}

it('continues PTY sweeps after an unverified managed stop only for explicit Force Delete', async () => {
  const fixture = failingServerSweep()
  fixture.stopWorktree.mockRejectedValue(new Error('server termination unverified'))
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    await expect(
      killAllProcessesForWorktree('w', {
        ...fixture,
        requirePhysicalStop: true,
        allowUnverifiedStop: true
      })
    ).resolves.toMatchObject({ runtimeStopped: 0 })
    expect(fixture.stopTerminalsForWorktree).toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('server termination unverified'))
  } finally {
    warn.mockRestore()
  }
})

it('bounds an unresponsive managed stop and continues only for explicit Force Delete', async () => {
  vi.useFakeTimers()
  const fixture = failingServerSweep()
  fixture.stopWorktree.mockReturnValue(new Promise(() => {}))
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const removal = killAllProcessesForWorktree('w', {
      ...fixture,
      requirePhysicalStop: true,
      allowUnverifiedStop: true,
      timeoutMs: 10
    })
    const checked = expect(removal).resolves.toMatchObject({ runtimeStopped: 0 })
    void checked.catch(() => {})
    await vi.advanceTimersByTimeAsync(2200)
    await checked
    expect(warn).toHaveBeenCalled()
  } finally {
    warn.mockRestore()
  }
})
