import { expect, it, vi } from 'vitest'
import {
  killAllProcessesForWorktree,
  type WorktreeTeardownRuntime
} from '../runtime/worktree-teardown'
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
