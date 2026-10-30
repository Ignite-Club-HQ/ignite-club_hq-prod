import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { stageProdRehearsal } from './prod-rehearsal-workspace.mjs';
import { sha256 } from './prod-release-review.mjs';

const evidenceText = readFileSync(new URL('../docs/release-review/prod-evidence-2026-10-30.json', import.meta.url), 'utf8');
const dispositionText = readFileSync(new URL('../docs/release-review/transition-dispositions-2026-10-30.json', import.meta.url), 'utf8');
const policy = JSON.parse(readFileSync(new URL('./auth-release-policy.json', import.meta.url), 'utf8'));
const dir = new URL('../supabase/migrations/', import.meta.url);
const files = Object.fromEntries(readdirSync(dir).filter(f => f.endsWith('.sql')).map(f => [f, readFileSync(new URL(f, dir), 'utf8')]));
const inputs = { evidenceText, dispositionText, policy, files };
const record = JSON.parse(dispositionText);
const eligible = record.migrations.find(e => e.disposition === 'adapt');
const candidate = { file: 'reviewed_adapter.sql', sql: 'SELECT 42;', sha256: sha256('SELECT 42;'), originals: [{ file: eligible.file, sha256: eligible.sha256 }] };

test('all 37 originals stay accounted for and nine excluded originals are physically absent', () => {
  const result = stageProdRehearsal(inputs);
  try {
    assert.equal(result.manifest.originals.length, 37);
    assert.equal(result.manifest.originals.filter(e => e.disposition === 'exclude-original').length, 9);
    assert.deepEqual(readdirSync(path.join(result.directory, 'candidates')), []);
    assert.equal(result.manifest.deploymentAuthorized, false);
    assert.equal(result.manifest.rehearsalOnly, true);
    assert.equal(result.manifest.unresolvedOriginals.length, 37);
    assert.equal(result.manifest.evidenceBytesSha256, sha256(evidenceText));
    assert.equal(result.manifest.dispositionBytesSha256, sha256(dispositionText));
  } finally { rmSync(result.directory, { recursive: true, force: true }); }
});
test('only explicitly supplied source-bound adaptations enter the disposable workspace', () => {
  const result = stageProdRehearsal({ ...inputs, candidates: [candidate] });
  try {
    assert.equal(readFileSync(path.join(result.directory, 'candidates', candidate.file), 'utf8'), 'SELECT 42;');
    assert.deepEqual(result.manifest.candidates[0].originals, candidate.originals);
    assert.equal(result.manifest.unresolvedOriginals.length, 36);
    assert.equal(result.manifest.deploymentAuthorized, false);
  } finally { rmSync(result.directory, { recursive: true, force: true }); }
});
test('source drift, missing/extra files and reordered dispositions fail closed', () => {
  for (const changed of [{ ...files, [eligible.file]: 'changed' }, Object.fromEntries(Object.entries(files).slice(1)), { ...files, '20261101000000_extra.sql': 'select 1;' }]) {
    assert.throws(() => stageProdRehearsal({ ...inputs, files: changed }));
  }
  assert.throws(() => stageProdRehearsal({ ...inputs, dispositionText: JSON.stringify({ ...record, migrations: [...record.migrations].reverse() }) }));
});
test('excluded/deferred source, stale bindings, duplicate links and path traversal cannot be staged', () => {
  const excluded = record.migrations.find(e => e.disposition === 'exclude-original');
  const deferred = record.migrations.find(e => e.disposition === 'defer-activation');
  for (const bad of [
    { ...candidate, originals: [{ file: excluded.file, sha256: excluded.sha256 }] },
    { ...candidate, originals: [{ file: deferred.file, sha256: deferred.sha256 }] },
    { ...candidate, originals: [{ file: eligible.file, sha256: sha256('stale') }] },
    { ...candidate, originals: [...candidate.originals, ...candidate.originals] },
    { ...candidate, file: '../escape.sql' },
    { ...candidate, sha256: sha256('wrong SQL') },
    { ...candidate, sql: files[eligible.file], sha256: sha256(files[eligible.file]) },
  ]) assert.throws(() => stageProdRehearsal({ ...inputs, candidates: [bad] }));
});
test('evidence substitution and release approval flags cannot unlock rehearsal packaging', () => {
  for (const changed of [{ ...record, deploymentAuthorized: true }, { ...record, evidenceSourceSha256: sha256('other evidence') }]) {
    assert.throws(() => stageProdRehearsal({ ...inputs, dispositionText: JSON.stringify(changed) }));
  }
});