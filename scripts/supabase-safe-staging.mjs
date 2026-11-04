import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const digest = text => createHash('sha256').update(text).digest('hex');
export const SAFE_TARGET = 'yabcfiuntwqjwvschnji';

/** Read the whole immutable source inventory, rejecting symlinked inputs. */
export function readSafeInputs(root) {
  function regular(relative, directory = false) {
    let current = root;
    const parts = relative.split('/');
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]);
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || (i < parts.length - 1 || directory ? !stat.isDirectory() : !stat.isFile())) {
        throw new Error('Safe staging requires regular files and directories');
      }
    }
    return current;
  }
  const dir = regular('supabase/migrations', true);
  const files = Object.fromEntries(readdirSync(dir).filter(name => name.endsWith('.sql')).sort()
    .map(name => [name, readFileSync(regular(`supabase/migrations/${name}`), 'utf8')]));
  const manifest = JSON.parse(readFileSync(regular('docs/release-review/safe-release-manifest.json'), 'utf8'));
  return { files, manifest };
}

/** Complete source-bound separation, never a filtered db-push or applied-history ledger. */
export function planSafeStaging(manifest, files, policy, ledger) {
  if (manifest?.schemaVersion !== 1 || manifest?.projectRef !== SAFE_TARGET
      || manifest?.mode !== 'review-only' || manifest?.deploymentAuthorized !== false) {
    throw new Error('Exact held safe-release manifest required');
  }
  if (!Array.isArray(ledger) || ledger.length > 10000
      || ledger.some(row => !/^\d{14}$/.test(row?.version ?? ''))
      || new Set(ledger.map(row => row.version)).size !== ledger.length) {
    throw new Error('Bounded unique live migration ledger required');
  }
  const names = Object.keys(files).sort();
  const entries = manifest.sources;
  if (!Array.isArray(entries) || entries.length !== names.length || names.length > 10000
      || entries.some((entry, index) => entry?.file !== names[index]
        || !/^\d{14}_[A-Za-z0-9_-]+\.sql$/.test(entry.file)
        || typeof files[entry.file] !== 'string' || entry.sha256 !== digest(files[entry.file])
        || !['candidate', 'hold'].includes(entry.disposition)
        || typeof entry.reason !== 'string' || !entry.reason.trim())) {
    throw new Error('Complete ordered fingerprint-matched original inventory required');
  }
  if (!Array.isArray(policy?.migrations)) throw new Error('Protected-source policy required');
  for (const entry of policy.migrations) {
    if (typeof files[entry.file] !== 'string' || digest(files[entry.file]) !== entry.sha256) {
      throw new Error('Protected original removed or edited');
    }
    if (entry.prodStatus === 'blocked' && entries.find(source => source.file === entry.file)?.disposition !== 'hold') {
      throw new Error('Blocked original cannot become a safe candidate');
    }
  }
  const applied = new Set(ledger.map(row => row.version));
  const candidates = entries.filter(entry => entry.disposition === 'candidate' && !applied.has(entry.file.split('_')[0]));
  const held = entries.filter(entry => entry.disposition === 'hold' && !applied.has(entry.file.split('_')[0]));
  return {
    manifestSha256: digest(JSON.stringify(manifest)),
    sourceInventory: entries.map(entry => ({ ...entry, recordedApplied: applied.has(entry.file.split('_')[0]) })),
    candidates, held,
    // Parsing and source selection cannot establish lifecycle/target equivalence.
    issues: ['Safe-only staging requires exact target-definition and dependency acceptance before deployment'],
    deploymentAuthorized: false,
    historyWrites: false,
  };
}