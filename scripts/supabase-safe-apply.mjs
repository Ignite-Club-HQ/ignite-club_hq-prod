import { createHash } from 'node:crypto';
import { SAFE_TARGET } from './supabase-safe-staging.mjs';

const digest = text => createHash('sha256').update(text).digest('hex');

/**
 * Owner-approved exact subset of safe-stage candidates. Each approved file must be
 * a fingerprint-matched candidate, unapplied on the target and parser-clean.
 * Held originals are never executed or recorded.
 *
 * `reviewed` is the owner-signed reviewed-findings ledger. It can neutralise only
 * the exact finding text on the exact fingerprint-matched file it was written for,
 * and only up to the occurrence count recorded there. Any finding it does not cover
 * stops the release.
 */
export function planSafeApply(approval, staged, files, findings, reviewed = null) {
  if (approval?.schemaVersion !== 1 || approval?.projectRef !== SAFE_TARGET
      || typeof approval?.approvedBy !== 'string' || !approval.approvedBy.trim()
      || !Array.isArray(approval?.migrations) || approval.migrations.length < 1 || approval.migrations.length > 10) {
    throw new Error('Exact owner approval for the PROD target required');
  }
  const approvedFiles = new Set(approval.migrations.map(item => item?.file));
  const ledger = readReviewedLedger(reviewed, approvedFiles);
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
    const own = findings.filter(f => String(f).startsWith(`${item.file}: `)).map(String);
    const counts = new Map();
    for (const f of own) {
      const text = f.slice(item.file.length + 2);
      counts.set(text, (counts.get(text) ?? 0) + 1);
    }
    for (const [text, count] of counts) {
      const entry = ledger.get(`${item.file}\u0000${text}`);
      if (!entry || entry.sha256 !== item.sha256 || entry.occurrences < count) {
        throw new Error(`${item.file}: structural check failed (${text})`);
      }
    }
    apply.push({ file: item.file, version: item.file.split('_')[0], name: item.file.slice(15, -4) });
  }
  apply.sort((x, y) => x.file.localeCompare(y.file));
  return { apply, skipped };
}

/** Validate the ledger shape and bind every entry to an approved, fingerprint-matched file. */
function readReviewedLedger(reviewed, approvedFiles) {
  const map = new Map();
  if (reviewed === null || reviewed === undefined) return map;
  if (reviewed?.schemaVersion !== 1 || reviewed?.projectRef !== SAFE_TARGET
      || typeof reviewed?.reviewedBy !== 'string' || !reviewed.reviewedBy.trim()
      || !Array.isArray(reviewed?.findings)) {
    throw new Error('Exact owner review ledger for flagged structural findings required');
  }
  const seen = new Set();
  for (const entry of reviewed.findings) {
    if (!entry || typeof entry.file !== 'string' || typeof entry.finding !== 'string'
        || typeof entry.sha256 !== 'string' || !Number.isInteger(entry.occurrences) || entry.occurrences < 1) {
      throw new Error('Flagged finding entries must be complete');
    }
    if (!approvedFiles.has(entry.file)) throw new Error(`${entry.file}: flagged finding review is not bound to an approved file`);
    const key = `${entry.file}\u0000${entry.finding}`;
    if (seen.has(key)) throw new Error(`${entry.file}: duplicate flagged finding review`);
    seen.add(key);
    map.set(key, { sha256: entry.sha256, occurrences: entry.occurrences });
  }
  return map;
}
