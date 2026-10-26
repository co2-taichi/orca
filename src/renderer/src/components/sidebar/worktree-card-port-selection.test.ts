import { describe, expect, it } from 'vitest'
import type { WorkspacePort } from '../../../../shared/workspace-ports'
import { selectWorktreeCardPorts } from './worktree-card-port-selection'

type OwnedPort = Extract<WorkspacePort, { kind: 'workspace' }>
function port(number: number, overrides: Partial<OwnedPort> = {}): OwnedPort {
  return {
    id: `port-${number}`,
    port: number,
    pid: 1,
    processName: 'java',
    bindHost: '127.0.0.1',
    connectHost: 'localhost',
    protocol: 'unknown',
    kind: 'workspace',
    owner: {
      worktreeId: 'repo::/app',
      repoId: 'repo',
      displayName: 'app',
      path: '/app',
      confidence: 'cwd'
    },
    ...overrides
  }
}

describe('selectWorktreeCardPorts', () => {
  it('keeps frontend and backend web ports while hiding same-process debug listeners', () => {
    const frontend = port(4008, {
      pid: 2,
      processName: 'node',
      advertisedUrl: 'http://localhost:4008'
    })
    const backend = port(9097, { protocol: 'http' })
    const debug = port(60312)
    expect(selectWorktreeCardPorts([debug, backend, frontend])).toEqual({
      visible: [frontend, backend],
      hidden: [debug]
    })
  })

  it('keeps a backend visible when the frontend advertises multiple web listeners', () => {
    const frontend = port(4008, { pid: 2, advertisedUrl: 'http://localhost:4008' })
    const extra = port(4009, { pid: 2, advertisedUrl: 'http://localhost:4009' })
    const backend = port(9097, { protocol: 'http' })
    expect(selectWorktreeCardPorts([extra, backend, frontend])).toEqual({
      visible: [frontend, backend],
      hidden: [extra]
    })
  })

  it('prioritizes advertised URLs over inferred HTTP and caps the card at two badges', () => {
    const advertised = port(9097, { advertisedUrl: 'http://localhost:9097' })
    const http = port(4008, { protocol: 'http' })
    const other = port(3000, { pid: 3, protocol: 'https' })
    const debug = port(60312)
    expect(selectWorktreeCardPorts([http, debug, other, advertised])).toEqual({
      visible: [other, advertised],
      hidden: [http, debug]
    })
  })

  it('uses one lowest unknown port per process without merging missing process ids', () => {
    const low = port(9097)
    const high = port(60312)
    const missing = port(5000, { pid: undefined })
    expect(selectWorktreeCardPorts([high, low, missing])).toEqual({
      visible: [missing, low],
      hidden: [high]
    })
  })

  it('excludes container and external listeners and deduplicates bind addresses', () => {
    const owned = port(4008, { protocol: 'http' })
    const duplicate = { ...owned, id: 'ipv6', bindHost: '::1' }
    const external: WorkspacePort = { ...port(9097), kind: 'external' }
    const container: WorkspacePort = { ...port(8080), kind: 'container' }
    expect(selectWorktreeCardPorts([external, container, duplicate, owned])).toEqual({
      visible: [duplicate],
      hidden: []
    })
    expect(selectWorktreeCardPorts([external, container])).toEqual({ visible: [], hidden: [] })
  })

  it('does not mutate scan order and clears badges after the last listener disappears', () => {
    const scan = [port(9097), port(4008, { pid: 2 })]
    const previous = [...scan]
    selectWorktreeCardPorts(scan)
    expect(scan).toEqual(previous)
    expect(selectWorktreeCardPorts([])).toEqual({ visible: [], hidden: [] })
  })
})
