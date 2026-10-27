import type { WorkspaceServerProcessManager } from './workspace-server-process-manager'

type ServerRuntime = { workspaceServers?: WorkspaceServerProcessManager }

/** A remote mirror can reuse the same ID as a server owned by this host. */
export async function withWorkspaceServerRemoval<T>(
  runtime: ServerRuntime,
  worktreeId: string,
  hostId: string | undefined,
  remove: () => Promise<T>
): Promise<T> {
  const release = beginWorkspaceServerRemoval(runtime, worktreeId, hostId)
  try {
    return await remove()
  } finally {
    release?.()
  }
}

export async function stopWorkspaceServersForRemoval(
  runtime: ServerRuntime | undefined,
  worktreeId: string,
  hostId?: string
): Promise<void> {
  if (!hostId || hostId === 'local') {
    await runtime?.workspaceServers?.stopWorktree(worktreeId)
  }
}

export function beginWorkspaceServerRemoval(
  runtime: ServerRuntime,
  worktreeId: string,
  hostId?: string
): (() => void) | undefined {
  return !hostId || hostId === 'local'
    ? runtime.workspaceServers?.beginWorktreeRemoval(worktreeId)
    : undefined
}
