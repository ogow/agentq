import {hostname, platform} from 'node:os';

type KillSignal = Parameters<Bun.Subprocess['kill']>[0];

export interface ManagedProcess {
  exited: Promise<number | null>;
  kill: (signal?: KillSignal) => void;
  pid?: number;
}

export class ProcessRegistry {
  private readonly processes = new Set<ManagedProcess>();

  track(process: ManagedProcess): () => void {
    this.processes.add(process);
    void process.exited.finally(() => {
      this.processes.delete(process);
    });

    return () => {
      this.processes.delete(process);
    };
  }

  async killAll(): Promise<void> {
    const processes = [...this.processes];
    this.processes.clear();
    await Promise.all(processes.map(process => killProcessTree(process)));
  }
}

export function currentHost(): string {
  return hostname();
}

export function isSameHost(host: string | undefined): boolean {
  return normalizeHost(host) === normalizeHost(currentHost());
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function killProcessTree(process: ManagedProcess): Promise<void> {
  const pid = process.pid;
  if (pid === undefined) {
    safeKill(process);
    return;
  }

  if (platform() === 'win32') {
    await killWindowsProcessTree(process, pid);
    return;
  }

  await killPosixProcessTree(process, pid);
}

export async function killProcessTreeByPid(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  if (platform() === 'win32') {
    await runAndIgnore(['taskkill', '/PID', String(pid), '/T', '/F']);
    return;
  }

  await killPosixProcessTreeByPid(pid);
}

async function killWindowsProcessTree(
  process: ManagedProcess,
  pid: number,
): Promise<void> {
  safeKill(process);
  await runAndIgnore(['taskkill', '/PID', String(pid), '/T', '/F']);
}

async function killPosixProcessTree(
  process: ManagedProcess,
  pid: number,
): Promise<void> {
  await terminatePosixTree(pid);
  safeKill(process, 'SIGTERM');

  const exited = await waitForExit(process, 500);
  if (exited) {
    return;
  }

  await forceKillPosixTree(pid);
  safeKill(process, 'SIGKILL');
}

async function killPosixProcessTreeByPid(pid: number): Promise<void> {
  await terminatePosixTree(pid);

  const exited = await waitForPidExit(pid, 500);
  if (exited) {
    return;
  }

  await forceKillPosixTree(pid);
}

async function terminatePosixTree(pid: number): Promise<void> {
  const descendants = await collectPosixDescendants(pid);
  const processes = [...descendants.reverse(), pid];

  for (const childPid of processes) {
    safeProcessKill(childPid, 'SIGTERM');
  }
}

async function forceKillPosixTree(pid: number): Promise<void> {
  const descendants = await collectPosixDescendants(pid);
  const processes = [...descendants.reverse(), pid];

  for (const childPid of processes) {
    safeProcessKill(childPid, 'SIGKILL');
  }
}

async function collectPosixDescendants(pid: number): Promise<number[]> {
  const directChildren = await listPosixChildren(pid);
  const descendants: number[] = [];

  for (const childPid of directChildren) {
    descendants.push(childPid);
    descendants.push(...(await collectPosixDescendants(childPid)));
  }

  return descendants;
}

async function listPosixChildren(pid: number): Promise<number[]> {
  try {
    const process = Bun.spawn(['pgrep', '-P', String(pid)], {
      stderr: 'ignore',
      stdout: 'pipe',
    });
    const [exitCode, stdout] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
    ]);
    if (exitCode !== 0) {
      return [];
    }

    return stdout
      .split(/\r?\n/)
      .map(line => Number(line.trim()))
      .filter(value => Number.isInteger(value) && value > 0);
  } catch {
    return [];
  }
}

async function waitForExit(
  process: ManagedProcess,
  timeoutMs: number,
): Promise<boolean> {
  const result = await Promise.race([
    process.exited.then(
      () => true,
      () => true,
    ),
    delay(timeoutMs).then(() => false),
  ]);

  return result;
}

async function waitForPidExit(
  pid: number,
  timeoutMs: number,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isPidAlive(pid)) {
      return true;
    }
    await delay(25);
  }

  return !isPidAlive(pid);
}

async function runAndIgnore(argv: string[]): Promise<void> {
  try {
    const process = Bun.spawn(argv, {stderr: 'ignore', stdout: 'ignore'});
    await process.exited;
  } catch {
    // Best-effort cleanup must not hide the original run failure.
  }
}

function safeKill(process: ManagedProcess, signal?: KillSignal): void {
  try {
    process.kill(signal);
  } catch {
    // The process may already be gone.
  }
}

function safeProcessKill(pid: number, signal: NodeJS.Signals): void {
  try {
    globalThis.process.kill(pid, signal);
  } catch {
    // The process may already be gone or owned by another process group.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeHost(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}
