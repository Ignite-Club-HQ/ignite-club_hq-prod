import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { assertCheckContext, callArguments, checkCalls, assessLinks } from './prod-connection-check-policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function runCheck({ ids, env, principal, invoke, decode, save }) {
  assertCheckContext(ids, env, principal);
  const report = { checkedAt: new Date().toISOString(), commit: env.GITHUB_SHA,
    scope: 'PROD infrastructure readback only; no activation or business records', rows: [], complete: true };
  for (const call of checkCalls(ids)) {
    const row = { name: call.name, id: call.id, method: call.method, query: call.query };
    try {
      const text = await invoke(callArguments(call, ids));
      if (text.length > 262144) throw new Error('Infrastructure reply exceeded evidence bound');
      if (call.method === 'read_group_opening_configuration') {
        const pairs = await decode(call.name, text);
        row.configuration = pairs;
        row.links = assessLinks(call.name, pairs, ids);
        row.verdict = row.links.some(link => !link.matches) ? 'LINK_MISMATCH' : 'READBACK';
      } else {
        row.evidence = text;
        row.verdict = /\bErr\b/.test(text) ? 'READER_DENIED' : 'REVIEW_ROUTING_EVIDENCE';
      }
    } catch {
      // Never include subprocess stderr: identity/library failures can contain
      // unrelated environment diagnostics. Infrastructure-only successful replies
      // are the sole contents of the report.
      row.verdict = 'UNREADABLE';
    }
    if (['UNREADABLE', 'READER_DENIED', 'LINK_MISMATCH'].includes(row.verdict)) report.complete = false;
    report.rows.push(row);
    await save(report);
  }
  return report;
}

async function main() {
  const env = process.env;
  const ids = JSON.parse(readFileSync(path.join(ROOT, 'deploy/prod/.icp/data/mappings/ic.ids.json'), 'utf8'));
  const principal = execFileSync('icp', ['identity', 'principal', '--identity', 'ignite-prod-governor'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const require = createRequire(path.join(env.CHECK_DEPS_DIR, 'package.json'));
  const { IDL } = require('@icp-sdk/core/candid');
  const pairsType = IDL.Vec(IDL.Tuple(IDL.Text, IDL.Text));
  const variantReaders = new Set(['identity_access', 'timer_jobs', 'shard_router']);
  const output = path.join(env.CHECK_REPORT_DIR, 'prod-connections.json');
  mkdirSync(env.CHECK_REPORT_DIR, { recursive: true });
  const report = await runCheck({ ids, env, principal,
    invoke: args => {
      // Hex decoding uses the local explicit return type; no interface fetch or
      // generic method selection, and no credentials/management environments.
      const a = [...args]; const at = a.indexOf('candid'); a[at] = 'hex';
      return execFileSync('icp', a, { cwd: env.RUNNER_TEMP, encoding: 'utf8', timeout: 60000, maxBuffer: 524288, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    },
    decode: (name, hex) => {
      if (!/^(?:0x)?[a-fA-F0-9]+$/.test(hex)) throw new Error('Unexpected hex reply');
      const bytes = Buffer.from(hex.replace(/^0x/, ''), 'hex');
      const type = variantReaders.has(name) ? IDL.Variant({ Ok: pairsType, Err: IDL.Text }) : pairsType;
      const [value] = IDL.decode([type], bytes);
      if (variantReaders.has(name)) {
        if (!value || !('Ok' in value)) throw new Error('Configuration reader denied');
        return value.Ok;
      }
      return value;
    },
    save: report => writeFileSync(output, JSON.stringify(report, null, 2)),
  });
  // Router replies were requested as hex too; decoding is deliberately not
  // guessed. Preserve bounded Candid bytes for review, not an activation verdict.
  const lines = ['### PROD connection check', '', '| Service | Check | Result |', '|---|---|---|',
    ...report.rows.map(r => `| ${r.name} | ${r.method} | ${r.verdict} |`), '',
    'No routing, canister configuration, DEV connection or database changes were made.',
    'Routing replies are evidence for review, not permission to open a group.',
    'Download prod-connection-check for full infrastructure evidence.'];
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  if (!report.complete) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('PROD connection check stopped; no configuration changes were attempted.'); process.exitCode = 1; });
}