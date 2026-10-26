import type { WorkspacePort } from '../../../../shared/workspace-ports'

type OwnedPort = Extract<WorkspacePort, { kind: 'workspace' }>

function priority(port: OwnedPort): number {
  return port.advertisedUrl ? 0 : port.protocol !== 'unknown' ? 1 : 2
}

export function selectWorktreeCardPorts(ports: readonly WorkspacePort[]): {
  visible: OwnedPort[]
  hidden: OwnedPort[]
} {
  const listeners = new Map<string, OwnedPort>()
  for (const port of ports) {
    if (port.kind !== 'workspace') {
      continue
    }
    const key = `${port.owner.worktreeId}:${port.port}`
    const previous = listeners.get(key)
    if (!previous || priority(port) < priority(previous)) {
      listeners.set(key, port)
    }
  }
  const owned = [...listeners.values()]
  const groups = new Map<string, OwnedPort[]>()
  for (const port of owned) {
    const key = `${port.owner.worktreeId}:${port.pid ?? port.id}`
    const group = groups.get(key) ?? []
    group.push(port)
    groups.set(key, group)
  }
  const candidates: OwnedPort[] = []
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => priority(a) - priority(b) || a.port - b.port)
    candidates.push(...sorted.slice(0, 1))
  }
  const seen = new Set<number>()
  const visible = candidates
    .sort((a, b) => priority(a) - priority(b) || a.port - b.port)
    .filter((port) => {
      if (seen.has(port.port)) {
        return false
      }
      seen.add(port.port)
      return true
    })
    .slice(0, 2)
    .sort((a, b) => a.port - b.port)
  const visibleIds = new Set(visible.map((port) => port.id))
  return { visible, hidden: owned.filter((port) => !visibleIds.has(port.id)) }
}
