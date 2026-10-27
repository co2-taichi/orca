import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { stripVTControlCharacters } from 'node:util'
import { spawnProcess } from '@orca/process-host'
import type { PipedChildProcess, PipedProcessSpec } from '@orca/process-host/process-spec'
import {
  signalProcessTree,
  forceTerminateProcessTree
} from '@orca/process-host/process-tree-termination'
import { advertisedUrlWatcher } from '../ports/advertised-url-watcher'
import {
  WORKSPACE_SERVER_OUTPUT_SOURCE_PREFIX,
  trimServerLogs,
  serverLogLevel,
  type WorkspaceServerFrame,
  type WorkspaceServerInfo,
  type WorkspaceServerLogLine,
  type WorkspaceServerSnapshot
} from '../../shared/workspace-server-process'

type Run = {
  info: Omit<WorkspaceServerInfo, 'active'>
  child: PipedChildProcess | null
  logs: WorkspaceServerLogLine[]
  pending: WorkspaceServerLogLine[]
  timer?: ReturnType<typeof setTimeout>
  stopped: boolean
  done: Promise<void>
  finish: () => void
  stopPromise?: Promise<WorkspaceServerSnapshot>
}
const active = (run: Run) =>
  run.child !== null || ['starting', 'running', 'stopping'].includes(run.info.status)

export class WorkspaceServerProcessManager {
  private readonly runs = new Map<string, Run>()
  private readonly listeners = new Map<string, Set<(frame: WorkspaceServerFrame) => void>>()
  private seq = 0
  private closing = false
  constructor(
    private readonly spawn: (spec: PipedProcessSpec) => PipedChildProcess = spawnProcess
  ) {}
  private key(worktreeId: string, port: number): string {
    return JSON.stringify([worktreeId, port])
  }
  private emit(worktreeId: string, frame: WorkspaceServerFrame): void {
    for (const listener of this.listeners.get(worktreeId) ?? []) {
      try {
        listener(frame)
      } catch {
        this.listeners.get(worktreeId)?.delete(listener)
      }
    }
  }
  private snapshot(run: Run): WorkspaceServerSnapshot {
    return { ...run.info, active: active(run), logs: [...run.logs] }
  }
  private flush(run: Run, reset = false): void {
    if (this.runs.get(this.key(run.info.worktreeId, run.info.port)) !== run) {
      return
    }
    clearTimeout(run.timer)
    run.timer = undefined
    const lines = run.pending
    run.pending = []
    this.emit(run.info.worktreeId, {
      type: 'update',
      info: { ...run.info, active: active(run) },
      lines,
      reset
    })
  }
  private append(run: Run, source: WorkspaceServerLogLine['source'], text: string): void {
    const line = {
      seq: ++this.seq,
      time: Date.now(),
      source,
      level: serverLogLevel(text),
      text: stripVTControlCharacters(text).slice(-8192)
    }
    line.level = serverLogLevel(line.text)
    if (line.level === 'error') {
      run.info.errorCount += 1
    }
    run.logs = trimServerLogs([...run.logs, line])
    if (!this.listeners.get(run.info.worktreeId)?.size) {
      return
    }
    run.pending = trimServerLogs([...run.pending, line])
    run.timer ??= setTimeout(() => this.flush(run), 100)
  }
  start(
    args: { worktreeId: string; port: number; name: string },
    spec: PipedProcessSpec
  ): WorkspaceServerSnapshot {
    const key = this.key(args.worktreeId, args.port)
    if (this.closing) {
      throw new Error('Server host is shutting down.')
    }
    const previous = this.runs.get(key)
    if (previous && (active(previous) || previous.stopPromise)) {
      throw new Error('This server is already running.')
    }
    if (!previous && this.runs.size >= 64) {
      throw new Error('Too many managed servers.')
    }
    if (previous) {
      clearTimeout(previous.timer)
    }
    let finish = () => {}
    const done = new Promise<void>((resolve) => {
      finish = resolve
    })
    const run: Run = {
      info: {
        id: randomUUID(),
        ...args,
        status: 'starting',
        exitCode: null,
        errorCount: 0,
        startedAt: Date.now()
      },
      child: null,
      logs: [],
      pending: [],
      stopped: false,
      done,
      finish
    }
    this.runs.set(key, run)
    const sourceId = WORKSPACE_SERVER_OUTPUT_SOURCE_PREFIX + run.info.id
    advertisedUrlWatcher.bindPty(sourceId, args.worktreeId)
    this.flush(run, true)
    try {
      const child = this.spawn({ ...spec, detached: process.platform !== 'win32' })
      run.child = child
      run.info.pid = child.pid
      const buffers = { stdout: '', stderr: '' }
      const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') }
      const ingest = (source: 'stdout' | 'stderr', chunk: Buffer | string) => {
        const text = typeof chunk === 'string' ? chunk : decoders[source].write(chunk)
        advertisedUrlWatcher.ingest(sourceId, text)
        const lines = (buffers[source] + text).split(/\r\n|[\n\r]/)
        buffers[source] = (lines.pop() ?? '').slice(-8192)
        for (const line of lines) {
          if (line) {
            this.append(run, source, line)
          }
        }
      }
      child.stdout.on('data', (chunk: Buffer | string) => ingest('stdout', chunk))
      child.stderr.on('data', (chunk: Buffer | string) => ingest('stderr', chunk))
      child.stdout.on('error', (error) => this.append(run, 'system', `Error: ${error.message}`))
      child.stderr.on('error', (error) => this.append(run, 'system', `Error: ${error.message}`))
      child.stdin.on('error', () => {})
      child.stdin.end()
      child.once('spawn', () => {
        if (!run.stopped) {
          run.info.status = 'running'
        }
        this.flush(run)
      })
      child.once('error', (error) => {
        this.append(run, 'system', `Error: ${error.message}`)
        run.info.status = 'error'
        this.flush(run)
      })
      child.once('close', (code, signal) => {
        for (const source of ['stdout', 'stderr'] as const) {
          const tail = buffers[source] + decoders[source].end()
          if (tail) {
            this.append(run, source, tail)
          }
        }
        run.child = null
        run.info.exitCode = code
        if (run.stopped) {
          run.info.status = 'stopped'
        } else if (code !== 0 || signal || run.info.status === 'error') {
          run.info.status = 'error'
          this.append(run, 'system', `Error: process exited (${code ?? signal ?? 'unknown'})`)
        } else {
          run.info.status = 'stopped'
        }
        advertisedUrlWatcher.unbindPty(sourceId)
        this.flush(run)
        run.finish()
      })
    } catch (error) {
      run.info.status = 'error'
      this.append(run, 'system', `Error: ${error instanceof Error ? error.message : String(error)}`)
      advertisedUrlWatcher.unbindPty(sourceId)
      this.flush(run)
      run.finish()
    }
    return this.snapshot(run)
  }
  async stop(worktreeId: string, port: number, runId: string): Promise<WorkspaceServerSnapshot> {
    const run = this.runs.get(this.key(worktreeId, port))
    if (!run || run.info.id !== runId) {
      throw new Error('The server run changed. Refresh and try again.')
    }
    if (run.stopPromise) {
      return run.stopPromise
    }
    if (!run.child) {
      return this.snapshot(run)
    }
    const child = run.child
    run.stopped = true
    run.info.status = 'stopping'
    this.flush(run)
    run.stopPromise = (async () => {
      await signalProcessTree(child, 'SIGTERM')
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        run.done,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 1500)
        })
      ])
      clearTimeout(timer)
      const gone = await forceTerminateProcessTree(child)
      if (!gone) {
        run.child = child
        run.info.status = 'error'
        this.append(run, 'system', 'Error: could not verify process termination')
        this.flush(run)
        throw new Error('Could not verify server termination.')
      }
      await run.done
      run.child = null
      run.info.status = 'stopped'
      this.flush(run)
      return this.snapshot(run)
    })().finally(() => {
      run.stopPromise = undefined
    })
    return run.stopPromise
  }
  subscribe(worktreeId: string, listener: (frame: WorkspaceServerFrame) => void): () => void {
    let listeners = this.listeners.get(worktreeId)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(worktreeId, listeners)
    }
    listeners.add(listener)
    listener({
      type: 'snapshot',
      runs: [...this.runs.values()]
        .filter((run) => run.info.worktreeId === worktreeId)
        .map((run) => this.snapshot(run))
    })
    return () => {
      listeners.delete(listener)
      if (!listeners.size) {
        this.listeners.delete(worktreeId)
      }
    }
  }
  private beginShutdown(): void {
    this.closing = true
    this.listeners.clear()
    for (const run of this.runs.values()) {
      clearTimeout(run.timer)
      run.timer = undefined
    }
  }
  async forceClose(): Promise<void> {
    this.beginShutdown()
    const results = await Promise.allSettled(
      [...this.runs.values()].map(async (run) => {
        if (!run.child) {
          return
        }
        run.stopped = true
        if (!(await forceTerminateProcessTree(run.child))) {
          throw new Error('Could not verify server termination.')
        }
      })
    )
    const failed = results.find((result) => result.status === 'rejected')
    if (failed?.status === 'rejected') {
      throw failed.reason
    }
  }
  async close(): Promise<void> {
    this.beginShutdown()
    const results = await Promise.allSettled(
      [...this.runs.values()]
        .filter(active)
        .map((run) => this.stop(run.info.worktreeId, run.info.port, run.info.id))
    )
    const failed = results.find((result) => result.status === 'rejected')
    if (failed?.status === 'rejected') {
      throw failed.reason
    }
  }
}
