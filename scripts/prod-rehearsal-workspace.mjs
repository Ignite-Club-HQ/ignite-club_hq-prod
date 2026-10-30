import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildProdTransitionReview, sha256 } from './prod-release-review.mjs';

/** Packages explicitly supplied candidates only. Never applies SQL or contacts a service. */
export function stageProdRehearsal({ evidenceText, dispositionText, files, policy, candidates = [] }) {
  const evidence = JSON.parse(evidenceText);
  const record = JSON.parse(dispositionText);
  const notes = record.migrations?.map(entry => ({ ...entry, reason: entry.transitionReason }));
  const review = buildProdTransitionReview(evidence, files, policy, notes);
  if (record.deploymentAuthorized !== false || record.reviewOnly !== true
      || record.evidenceSourceSha256 !== review.evidenceSourceSha256
      || record.migrations.some(entry => entry.releaseStatus !== 'hold')) {
    throw new Error('Held, evidence-bound review required');
  }
  const originals = new Map(review.migrations.map(entry => [entry.file, entry]));
  const names = new Set();
  const bindings = new Set();
  const staged = candidates.map(candidate => {
    if (!candidate || !/^[a-z0-9][a-z0-9_-]*\.sql$/.test(candidate.file ?? '')
        || names.has(candidate.file) || typeof candidate.sql !== 'string' || !candidate.sql.trim()
        || sha256(candidate.sql) !== candidate.sha256
        || !Array.isArray(candidate.originals) || candidate.originals.length === 0) {
      throw new Error('Unique named hash-bound SQL candidate required');
    }
    names.add(candidate.file);
    for (const binding of candidate.originals) {
      const original = originals.get(binding.file);
      if (!original || binding.sha256 !== original.sha256 || bindings.has(binding.file)
          || original.disposition === 'exclude-original' || original.disposition === 'defer-activation') {
        throw new Error('Candidate must bind unique, eligible source originals');
      }
      bindings.add(binding.file);
    }
    if (review.migrations.some(entry => entry.sha256 === candidate.sha256)) {
      throw new Error('Original migrations cannot be replayed as rehearsal adaptations');
    }
    return { file: candidate.file, sha256: candidate.sha256, originals: candidate.originals };
  });
  const manifest = {
    schemaVersion: 1, rehearsalOnly: true, deploymentAuthorized: false,
    independentlyVerifiedConnection: false,
    evidenceBytesSha256: sha256(evidenceText), dispositionBytesSha256: sha256(dispositionText),
    originals: review.migrations,
    candidates: staged,
    unresolvedOriginals: review.migrations.filter(entry => !bindings.has(entry.file)).map(entry => entry.file),
  };
  // All inputs validate before any output is created. No repository/hosted target option exists.
  const directory = mkdtempSync(path.join(tmpdir(), 'ignite-prod-rehearsal-'));
  mkdirSync(path.join(directory, 'candidates'));
  for (const candidate of candidates) writeFileSync(path.join(directory, 'candidates', candidate.file), candidate.sql, { flag: 'wx' });
  writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  return { directory, manifest };
}