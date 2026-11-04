import { createHash } from 'node:crypto';
import { SAFE_TARGET } from './supabase-safe-staging.mjs';

const digest = text => createHash('sha256').update(text).digest('hex');

/**
 * Owner-approved exact subset of safe-stage candidates. Each approved file must be
 * a fingerprint-matched candidate, unapplied on the target and parser-clean.
 * Held originals are never executed or recorded.
 */
export function planSafeApply(approval, staged, files, findings) {
  if (approval?.schemaVersion !== 1 || approval?.projectRef !== SAFE_TARGET
      || typeof approval?.approvedBy !== 'string' || !approval.approvedBy.trim()
      || !Array.isArray(approval?.migrations) || approval.migrations.length < 1 || approval.migrations.length > 10) {
    throw new Error('Exact owner approval for the PROD target required');
  }
  const candidates = new Map(staged.candidates.map(entry => [entry.file, entry]));
  const heldFiles = new Set(staged.held.map(entry => entry.file));
  const seen = new Set();
  const apply = [];
  const skipped = [];
  for (const item of approval.migrations) {
    if (!item || typeof item.file !== 'string' || seen.has(item.file)) throw new Error('Unique approved files required');
    seen.add(item.file);
    if (heldFiles.has(item.file)) throw new Error(`${item.file}: held original cannot be approved`);
    if (typeof files[item.file] !== 'string' || digest(files[item.file]) !== item.sha256) {
      throw new Error(`${item.file}: approved fingerprint does not match source`);
    }
    if (!candidates.has(item.file)) { skipped.push(item.file); continue; } // already applied
    if (findings.some(f => String(f).startsWith(item.file))) throw new Error(`${item.file}: structural check failed`);
    apply.push({ file: item.file, version: item.file.split('_')[0], name: item.file.slice(15, -4) });
  }
  apply.sort((x, y) => x.file.localeCompare(y.file));
  return { apply, skipped };
}
