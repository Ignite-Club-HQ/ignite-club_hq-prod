import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { auditAuthRelease } from './auth-release-preflight.mjs';

export const sha256 = text => createHash('sha256').update(text).digest('hex');

/** Offline comparison only: supplied evidence never authorizes a target write. */
export function buildProdReleaseReview(evidence, files, policy) {
  if (evidence?.projectRef !== 'yabcfiuntwqjwvschnji'
      || evidence?.origin !== 'owner-supplied-sql-editor-export'
      || !/^[a-f0-9]{64}$/.test(evidence?.sourceSha256 ?? '')) {
    throw new Error('Fingerprint-bound owner-supplied PROD evidence required');
  }
  const issues = auditAuthRelease(policy, files, evidence.appliedVersions);
  const applied = new Set(evidence.appliedVersions);
  const protectedFiles = new Map(policy.migrations.map(entry => [entry.file, entry]));
  const migrations = Object.keys(files).sort().map(file => ({
    file,
    sha256: sha256(files[file]),
    recordedApplied: applied.has(file.split('_')[0]),
    releaseStatus: 'hold',
    reason: protectedFiles.get(file)?.reason
      ?? 'Target object definitions, privileges and lifecycle effects require review; filename absence is not proof of missing schema',
  }));
  return {
    schemaVersion: 1,
    projectRef: evidence.projectRef,
    evidenceSourceSha256: evidence.sourceSha256,
    independentlyVerifiedConnection: false,
    deploymentAuthorized: false,
    appliedCount: evidence.appliedVersions.length,
    pendingCount: migrations.filter(entry => !entry.recordedApplied).length,
    issues,
    migrations,
  };
}

/** Dispositions are review notes only, never an executable or filtered runner plan. */
export function buildProdTransitionReview(evidence, files, policy, dispositions) {
  const review = buildProdReleaseReview(evidence, files, policy);
  const expected = review.migrations;
  const allowed = new Set(['verify-overlap', 'adapt', 'exclude-original', 'review-effects', 'defer-activation']);
  if (!Array.isArray(dispositions) || dispositions.length !== expected.length
      || dispositions.some((entry, index) => !entry || entry.file !== expected[index].file
        || entry.sha256 !== expected[index].sha256 || !allowed.has(entry.disposition)
        || typeof entry.reason !== 'string' || !entry.reason.trim())) {
    throw new Error('Complete ordered hash-matched source dispositions required');
  }
  return {
    ...review,
    reviewOnly: true,
    migrations: expected.map((entry, index) => ({ ...entry,
      disposition: dispositions[index].disposition, transitionReason: dispositions[index].reason,
    })),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error('Provide the reviewed evidence JSON path; this tool never contacts a database');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const evidence = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    const policy = JSON.parse(readFileSync(path.join(root, 'scripts/auth-release-policy.json'), 'utf8'));
    const dir = path.join(root, 'supabase/migrations');
    const files = Object.fromEntries(readdirSync(dir).filter(name => name.endsWith('.sql'))
      .map(name => [name, readFileSync(path.join(dir, name), 'utf8')]));
    console.log(JSON.stringify(buildProdReleaseReview(evidence, files, policy), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}