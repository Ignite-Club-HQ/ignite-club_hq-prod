import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Own exactly one disposable local process group. Never discovers or kills
// unrelated servers, and never accepts a supplied remote URL.
export function requirePocketIc14(binary) {
  if (!binary || !path.isAbsolute(binary)) throw new Error('Absolute pinned POCKET_IC_BIN required');
  const version = execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 5000 }).trim();
  if (!/\b14\.0\.0\b/.test(version)) throw new Error('PocketIC 14.0.0 required by @dfinity/pic 0.23.0');
  return version;
}

export async function stopOwnedProcess(child, { graceMs = 1500 } = {}) {
  if (!child.pid) return;
  // Negative PID scopes signals to the detached group created below.
  const signal = value => {
    try { process.kill(-child.pid, value); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const exited = child.exitCode !== null || child.signalCode !== null;
  if (!exited) {
    const exit = new Promise(resolve => child.once('exit', resolve));
    signal('SIGTERM');
    await Promise.race([exit, delay(graceMs)]);
  }
  // Also terminate any owned descendant left behind after the parent exited.
  signal('SIGKILL');
}

export async function startRemovalLocalServer({ binary, hardTtlSeconds = 120 } = {}) {
  if (process.platform !== 'linux') throw new Error('Isolated Linux local test worker required');
  if (!Number.isInteger(hardTtlSeconds) || hardTtlSeconds < 10 || hardTtlSeconds > 1800)
    throw new Error('Bounded local server deadline required');
  const version = requirePocketIc14(binary);
  const directory = mkdtempSync(path.join(tmpdir(), 'ignite-removal-local-'));
  const portFile = path.join(directory, 'port');
  const child = spawn(binary, ['--ip-addr', '127.0.0.1', '--port-file', portFile,
    '--hard-ttl', String(hardTtlSeconds)], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let startupError;
  child.on('error', error => { startupError = error; });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  let closed = false;
  const stop = async () => {
    if (closed) return;
    closed = true;
    await stopOwnedProcess(child);
    rmSync(directory, { recursive: true, force: true });
  };
  const deadline = setTimeout(() => { void stop(); }, hardTtlSeconds * 1000 + 2000);
  deadline.unref();
  try {
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      if (startupError) throw startupError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Local test server exited before startup');
      let port;
      try { port = readFileSync(portFile, 'utf8').trim(); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (port && /^\d+$/.test(port) && Number(port) > 0 && Number(port) <= 65535)
        return { url: `http://127.0.0.1:${port}`, version, stop: async () => { clearTimeout(deadline); await stop(); } };
      await delay(50);
    }
    throw new Error('Local test server startup deadline exceeded');
  } catch (error) { clearTimeout(deadline); await stop(); throw error; }
}