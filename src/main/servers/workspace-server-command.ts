import path from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import type { PipedProcessSpec } from '@orca/process-host/process-spec'
import { validateWindowsCmdArguments } from '@orca/process-host/windows-command-line'
import { hostShellEnvironment } from '../runtime/structured-agent-shell-environment'
import { resolveWindowsShellStartupFamily } from '../../shared/windows-terminal-shell'

export function workspaceServerShellCommand(
  program: string,
  command: string,
  platform: NodeJS.Platform
): Pick<PipedProcessSpec, 'program' | 'args' | 'windowsVerbatimArguments'> {
  const family = platform === 'win32' ? resolveWindowsShellStartupFamily(program) : 'posix'
  if (family === 'cmd') {
    validateWindowsCmdArguments([command])
    return { program, args: ['/d', '/s', '/c', `"${command}"`], windowsVerbatimArguments: true }
  }
  return {
    program,
    args:
      family === 'powershell'
        ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]
        : [/(?:^|[/\\])(?:csh|tcsh|sh|dash)$/.test(program) ? '-c' : '-lc', command]
  }
}

export async function workspaceServerWorkingDirectory(
  rootPath: string,
  requestedCwd: string
): Promise<{ root: string; cwd: string }> {
  const root = await realpath(rootPath)
  const cwd = await realpath(path.resolve(root, requestedCwd))
  const relative = path.relative(root, cwd)
  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    !(await stat(cwd)).isDirectory()
  ) {
    throw new Error('The server working directory must be inside its workspace.')
  }
  return { root, cwd }
}

export async function prepareWorkspaceServerCommand(args: {
  rootPath: string
  cwd: string
  command: string
  settings?: { terminalWindowsShell?: string; terminalDefaultShell?: string }
}): Promise<{ root: string; spec: PipedProcessSpec }> {
  const { root, cwd } = await workspaceServerWorkingDirectory(args.rootPath, args.cwd)
  const env = await hostShellEnvironment()
  const program =
    process.platform === 'win32'
      ? args.settings?.terminalWindowsShell || 'powershell.exe'
      : args.settings?.terminalDefaultShell || env.SHELL || '/bin/sh'
  return {
    root,
    spec: {
      ...workspaceServerShellCommand(program, args.command, process.platform),
      cwd,
      env: { ...env, NO_COLOR: '1', FORCE_COLOR: '0' }
    }
  }
}
