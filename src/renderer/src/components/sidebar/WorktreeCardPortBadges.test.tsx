// @vitest-environment happy-dom
import { fireEvent, render, screen, cleanup, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspacePort } from '../../../../shared/workspace-ports'
import { WorktreeCardPortsTrigger } from './WorktreeCardPortBadges'

const mocks = vi.hoisted(() => ({
  open: vi.fn(async () => ({ ok: true })),
  createBrowserTab: vi.fn(),
  setRemoteBrowserPageHandle: vi.fn(),
  recordFeatureInteraction: vi.fn()
}))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector(mocks)
}))
vi.mock('@/runtime/use-worktree-runtime-target', () => ({
  useWorktreeRuntimeTarget: () => ({ kind: 'local' })
}))
vi.mock('@/lib/workspace-port-localhost-label-selector', () => ({
  useLocalhostLabelRouteForPort: () => null
}))
vi.mock('@/lib/workspace-port-actions', () => ({ openWorkspacePortInBrowser: mocks.open }))

const port: WorkspacePort = {
  id: '4008',
  port: 4008,
  pid: 12,
  processName: 'node',
  protocol: 'http',
  bindHost: '127.0.0.1',
  connectHost: 'localhost',
  kind: 'workspace',
  advertisedUrl: 'http://localhost:4008',
  owner: {
    worktreeId: 'repo::/app',
    repoId: 'repo',
    displayName: 'app',
    path: '/app',
    confidence: 'cwd'
  }
}
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('WorktreeCardPortsTrigger', () => {
  it('opens the owning workspace browser without triggering the surrounding card', async () => {
    const activate = vi.fn()
    render(
      <div onClick={activate}>
        <WorktreeCardPortsTrigger ports={[port]} />
      </div>
    )
    const badge = screen.getByRole('button', { name: /Open in Browser: 4008/ })
    expect(badge.title).toContain('node')
    fireEvent.click(badge)
    await waitFor(() =>
      expect(mocks.open).toHaveBeenCalledWith(
        expect.objectContaining({
          port,
          runtimeTarget: { kind: 'local' },
          openInOrcaBrowser: true,
          createBrowserTab: mocks.createBrowserTab
        })
      )
    )
    expect(activate).not.toHaveBeenCalled()
  })

  it('retains auxiliary ports in the overflow label and removes stopped listeners', () => {
    const debug: WorkspacePort = {
      ...port,
      id: 'debug',
      port: 60312,
      advertisedUrl: undefined,
      protocol: 'unknown'
    }
    const view = render(<WorktreeCardPortsTrigger ports={[port, debug]} />)
    expect(screen.getByText('+1').title).toContain('60312')
    expect(screen.queryByRole('button', { name: /60312/ })).toBeNull()
    view.rerender(<WorktreeCardPortsTrigger ports={[]} />)
    expect(view.container.textContent).toBe('')
  })
})
