import React, { useEffect, useMemo, useState } from 'react'
import { Loader2, Play, ScrollText, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { openWorkspacePortLogs } from '@/lib/workspace-port-logs'
import { startWorkspaceServer } from '@/lib/start-workspace-server'
import {
  matchingWorkspaceServerPort,
  saveWorkspaceServerLaunch,
  useWorkspaceServerLaunches,
  workspaceServerLogPort,
  type WorkspaceServerLaunch
} from '@/lib/workspace-server-launches'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { WorkspacePort, WorkspacePortScanResult } from '../../../../shared/workspace-ports'

export function WorkspaceServerLaunchList({
  worktreeId,
  runtimeTarget,
  executionHostId,
  scan,
  onConfigure,
  onRefresh
}: {
  worktreeId: string
  runtimeTarget: RuntimeClientTarget
  executionHostId: string
  scan: WorkspacePortScanResult | null
  onConfigure: (port: WorkspacePort & { kind: 'workspace' }) => void
  onRefresh: () => Promise<unknown>
}): React.JSX.Element | null {
  const records = useWorkspaceServerLaunches()
  const tabs = useAppStore((state) => state.tabsByWorktree[worktreeId])
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const entries = useMemo(
    () =>
      records.filter(
        (entry) =>
          entry.worktreeId === worktreeId &&
          entry.executionHostId === executionHostId &&
          entry.runtimeTarget.kind === runtimeTarget.kind &&
          (entry.runtimeTarget.kind !== 'environment' ||
            (runtimeTarget.kind === 'environment' &&
              entry.runtimeTarget.environmentId === runtimeTarget.environmentId))
      ),
    [records, worktreeId, executionHostId, runtimeTarget]
  )
  useEffect(() => {
    for (const entry of entries) {
      const port = matchingWorkspaceServerPort(entry, scan)
      if (
        port &&
        (entry.launchTabId || (port.sourcePtyId && port.sourcePtyId !== entry.sourcePtyId))
      ) {
        try {
          saveWorkspaceServerLaunch({
            ...entry,
            launchTabId: undefined,
            sourcePtyId: port.sourcePtyId ?? entry.sourcePtyId
          })
        } catch (error) {
          toast.error(String(error))
        }
      }
    }
  }, [entries, scan])
  const stopped = entries.filter((entry) => !matchingWorkspaceServerPort(entry, scan))
  if (!stopped.length) {
    return null
  }
  const start = async (entry: WorkspaceServerLaunch) => {
    setBusy((current) => new Set(current).add(entry.id))
    try {
      await startWorkspaceServer(entry)
      await onRefresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy((current) => {
        const next = new Set(current)
        next.delete(entry.id)
        return next
      })
    }
  }
  const logs = (entry: WorkspaceServerLaunch) => {
    const ptyId = tabs?.find((tab) => tab.id === entry.launchTabId)?.ptyId ?? entry.sourcePtyId
    if (
      !openWorkspacePortLogs(
        { ...workspaceServerLogPort(entry), kind: 'workspace', sourcePtyId: ptyId ?? undefined },
        runtimeTarget
      )
    ) {
      toast.error(
        translate(
          'auto.components.right.sidebar.index.serverLogsUnavailable',
          'No source terminal available'
        )
      )
    }
  }
  return (
    <section
      className="px-3 pt-2"
      aria-label={translate('auto.components.right.sidebar.index.savedServers', 'Saved Servers')}
    >
      <div className="mb-1 border-b border-border/40 py-1 text-3xs font-semibold uppercase tracking-wider text-muted-foreground">
        {translate('auto.components.right.sidebar.index.savedServers', 'Saved Servers')}
      </div>
      {stopped.map((entry) => {
        const pending =
          busy.has(entry.id) ||
          Boolean(entry.launchTabId && (!tabs || tabs.some((tab) => tab.id === entry.launchTabId)))
        const blocked = scan?.ports.some((port) => port.port === entry.port)
        const status = pending
          ? translate(
              'auto.components.right.sidebar.index.serverStarting',
              'Starting — check terminal'
            )
          : !scan || scan.unavailableReason
            ? translate(
                'auto.components.right.sidebar.index.serverScanRequired',
                'Waiting for port scan'
              )
            : blocked
              ? translate(
                  'auto.components.right.sidebar.index.serverPortBusy',
                  'Port already in use'
                )
              : translate('auto.components.right.sidebar.index.serverStopped', 'Stopped')
        return (
          <div
            key={entry.id}
            className="group flex items-center gap-2 rounded px-1 py-2 hover:bg-accent/50"
            aria-label={entry.name}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-foreground">{entry.name}</div>
              <div className="text-2xs text-muted-foreground">
                :{entry.port} · {status}
              </div>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled={pending || !scan || Boolean(scan.unavailableReason) || blocked}
                    aria-label={translate(
                      'auto.components.right.sidebar.index.startServer',
                      'Start Server'
                    )}
                    onClick={() => void start(entry)}
                  >
                    {pending ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                {translate('auto.components.right.sidebar.index.startServer', 'Start Server')}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={translate(
                    'auto.components.right.sidebar.index.openServerLogs',
                    'Open Logs'
                  )}
                  onClick={() => logs(entry)}
                >
                  <ScrollText size={13} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                {translate('auto.components.right.sidebar.index.openServerLogs', 'Open Logs')}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={translate(
                    'auto.components.right.sidebar.index.configureServerCommand',
                    'Configure Startup Command'
                  )}
                  onClick={() => {
                    const port = workspaceServerLogPort(entry)
                    if (port.kind === 'workspace') {
                      onConfigure(port)
                    }
                  }}
                >
                  <Settings2 size={13} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={4}>
                {translate(
                  'auto.components.right.sidebar.index.configureServerCommand',
                  'Configure Startup Command'
                )}
              </TooltipContent>
            </Tooltip>
          </div>
        )
      })}
    </section>
  )
}
