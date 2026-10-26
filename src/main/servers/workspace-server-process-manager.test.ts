import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawnProcess } from '@orca/process-host'
import { WorkspaceServerProcessManager } from './workspace-server-process-manager'
import type {
  WorkspaceServerFrame,
  WorkspaceServerSnapshot
} from '../../shared/workspace-server-process'

const managers: WorkspaceServerProcessManager[] = []
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.close()))
})
function fixture(script: string) {
  let spawns = 0
  const manager = new WorkspaceServerProcessManager((spec) => {
    spawns += 1
    return spawnProcess({ ...spec, program: process.execPath, args: ['-e', script] })
  })
  managers.push(manager)
  let run: WorkspaceServerSnapshot | undefined
  const receive = (frame: WorkspaceServerFrame) => {
    run =
      frame.type === 'snapshot'
        ? frame.runs.at(-1)
        : { ...frame.info, logs: [...(frame.reset ? [] : (run?.logs ?? [])), ...frame.lines] }
  }
  manager.subscribe('test-workspace', receive)
  const start = () =>
    manager.start(
      { worktreeId: 'test-workspace', port: 41051, name: 'Test' },
      { program: 'unused', cwd: process.cwd() }
    )
  return {
    manager,
    start,
    get run() {
      return run
    },
    get spawns() {
      return spawns
    }
  }
}
describe('managed server lifetime', () => {
  it('captures output without terminal tabs and reuses one server identity across repeated start/stop', async () => {
    const f = fixture(
      "console.log('ready'); console.error('INFO health ready'); setInterval(()=>{},1000)"
    )
    for (let cycle = 0; cycle < 2; cycle += 1) {
      const started = f.start()
      expect(() => f.start()).toThrow('already running')
      await vi.waitFor(() => expect(f.run?.logs.some((line) => line.text === 'ready')).toBe(true), {
        timeout: 3000,
        interval: 10
      })
      expect(f.run?.errorCount).toBe(0)
      const stopped = await f.manager.stop('test-workspace', 41051, started.id)
      expect(stopped.status).toBe('stopped')
    }
    expect(f.spawns).toBe(2)
  })
  it('surfaces startup errors and nonzero exits even when no listening port ever appears', async () => {
    const f = fixture("console.error('ERROR startup failed'); process.exitCode=7")
    f.start()
    await vi.waitFor(() => expect(f.run?.status).toBe('error'), { timeout: 3000, interval: 10 })
    expect(f.run?.exitCode).toBe(7)
    expect(f.run?.errorCount).toBeGreaterThan(0)
    expect(f.run?.logs.some((line) => line.text.includes('startup failed'))).toBe(true)
  })
  it('refuses stale stop requests after a new run has started', async () => {
    const f = fixture("console.log('ready'); setInterval(()=>{},1000)")
    const first = f.start()
    await f.manager.stop('test-workspace', 41051, first.id)
    const second = f.start()
    await expect(f.manager.stop('test-workspace', 41051, first.id)).rejects.toThrow('run changed')
    await f.manager.stop('test-workspace', 41051, second.id)
  })
})
