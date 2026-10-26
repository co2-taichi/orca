import type React from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { useAppStore } from '@/store'
import { useWorktreeRuntimeTarget } from '@/runtime/use-worktree-runtime-target'
import { useLocalhostLabelRouteForPort } from '@/lib/workspace-port-localhost-label-selector'
import { openWorkspacePortInBrowser } from '@/lib/workspace-port-actions'
import { addressForPort } from '@/lib/workspace-port-urls'
import { translate } from '@/i18n/i18n'
import type { WorkspacePort } from '../../../../shared/workspace-ports'
import { selectWorktreeCardPorts } from './worktree-card-port-selection'

function portLabel(port: WorkspacePort): string {
  return `${port.port} · ${port.processName ?? (port.pid ? `PID ${port.pid}` : 'Unknown process')} · ${addressForPort(port)}`
}

function WorktreeCardPortBadge({ port }: { port: WorkspacePort }): React.JSX.Element {
  const createBrowserTab = useAppStore((s) => s.createBrowserTab)
  const setRemoteBrowserPageHandle = useAppStore((s) => s.setRemoteBrowserPageHandle)
  const recordFeatureInteraction = useAppStore((s) => s.recordFeatureInteraction)
  const runtimeTarget = useWorktreeRuntimeTarget(
    port.kind === 'workspace' ? port.owner.worktreeId : null
  )
  const localhostLabelRoute = useLocalhostLabelRouteForPort(port)
  const canOpen =
    port.kind === 'workspace' && Boolean(port.advertisedUrl || port.protocol !== 'unknown')
  const label = portLabel(port)

  if (!canOpen) {
    return (
      <Badge variant="workspacePort" title={label}>
        {port.port}
      </Badge>
    )
  }

  return (
    <Badge asChild variant="workspacePort">
      <button
        type="button"
        title={label}
        aria-label={`${translate('auto.components.sidebar.WorktreeCardPorts.33bc7d7495', 'Open in Browser')}: ${label}`}
        onClick={(event) => {
          event.stopPropagation()
          recordFeatureInteraction('ports')
          if (event.detail > 0) {
            event.currentTarget.blur()
          }
          void openWorkspacePortInBrowser({
            port,
            runtimeTarget,
            createBrowserTab,
            setRemoteBrowserPageHandle,
            openInOrcaBrowser: true,
            localhostLabelRoute
          }).then((result) => {
            if (!result.ok) {
              toast.error(
                translate(
                  'auto.components.sidebar.WorktreeCardPorts.d1113f4660',
                  'Failed to open browser'
                ),
                { description: result.reason }
              )
            }
          })
        }}
      >
        {port.port}
      </button>
    </Badge>
  )
}

export function WorktreeCardPortsTrigger({
  ports
}: {
  ports: WorkspacePort[]
}): React.JSX.Element | null {
  const { visible, hidden } = selectWorktreeCardPorts(ports)
  if (visible.length === 0) {
    return null
  }

  return (
    <span
      className="inline-flex shrink-0 items-center gap-0.5"
      aria-label={translate(
        'auto.components.sidebar.WorktreeCardPorts.fed49903c9',
        '{{value0}} live {{value1}}',
        {
          value0: visible.length + hidden.length,
          value1: visible.length + hidden.length === 1 ? 'port' : 'ports'
        }
      )}
    >
      {visible.map((port) => (
        <WorktreeCardPortBadge key={port.id} port={port} />
      ))}
      {hidden.length > 0 && (
        <span
          className="text-3xs tabular-nums text-muted-foreground"
          title={hidden.map(portLabel).join('\n')}
        >
          +{hidden.length}
        </span>
      )}
    </span>
  )
}
