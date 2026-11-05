import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateHostFault(result) {
  if (result?.faults !== 1 || result?.writeBit !== 1 || result?.recovered !== true)
    throw new Error('Host write-fault metadata incompatible with IC memory tracking; use an isolated native Linux x86-64 worker');
  return result;
}

export function removalHostPreflight() {
  if (process.platform !== 'linux' || process.arch !== 'x64')
    throw new Error('Native Linux x86-64 removal test worker required');
  const source = fileURLToPath(new URL('./removal-host-fault-probe.c', import.meta.url));
  const directory = mkdtempSync(path.join(tmpdir(), 'ignite-removal-host-'));
  try {
    const binary = path.join(directory, 'fault-probe');
    execFileSync('gcc', ['-std=c11', '-O0', '-Wall', '-Wextra', '-Werror', source, '-o', binary], { timeout: 10000 });
    const output = execFileSync(binary, [], { encoding: 'utf8', timeout: 5000 });
    const result = JSON.parse(output);
    const report = { ...result, sourceSha256: createHash('sha256').update(readFileSync(source)).digest('hex'),
      kernel: execFileSync('uname', ['-sr'], { encoding: 'utf8', timeout: 5000 }).trim() };
    try { validateHostFault(report); }
    catch (error) { error.hostReport = report; throw error; }
    return report;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}