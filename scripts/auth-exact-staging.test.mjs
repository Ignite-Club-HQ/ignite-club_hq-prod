import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { buildAuthExactStagingManifest, readAuthExactInputs, stageAuthExactWorkspace } from './auth-exact-staging.mjs';
import { sha256 } from './prod-release-review.mjs';

const inputs = readAuthExactInputs();
test('exact auth package excludes all 38 originals and every score/AI transition', () => {
  const result = stageAuthExactWorkspace(inputs);
  try {
    assert.equal(result.manifest.originals.length, 38);
    assert.ok(result.manifest.originals.every(e => e.executeOriginal === false));
    assert.deepEqual(readdirSync(result.directory).sort(), ['candidates', 'manifest.json']);
    assert.deepEqual(readdirSync(path.join(result.directory, 'candidates')).sort(), ['01_signup-helper.sql', '02_signup-access.sql']);
    for (const c of result.manifest.candidates) assert.equal(readFileSync(path.join(result.directory, c.file), 'utf8'), inputs.texts[c.source]);
    for (const key of ['executionAuthorized', 'deploymentAuthorized', 'mergeAuthorized', 'runnerConsumable', 'dataClearingAuthorized', 'activationIncluded', 'sourceClosureAccepted']) assert.equal(result.manifest[key], false);
  } finally { rmSync(result.directory, { recursive: true, force: true }); }
});
test('pinned bytes reject recomputed caller hashes and substituted evidence or owner intent', () => {
  for (const file of Object.keys(inputs.texts)) assert.throws(() => buildAuthExactStagingManifest({ ...inputs, texts: { ...inputs.texts, [file]: inputs.texts[file] + '\n' } }), /Reviewed bytes changed/);
  const sql = 'CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger AS $$ BEGIN RETURN NEW; END $$ LANGUAGE plpgsql;';
  assert.throws(() => buildAuthExactStagingManifest({ ...inputs, texts: { ...inputs.texts, 'extra.sql': sql, sha256: sha256(sql) } }), /Exact bound input/);
});
test('complete originals and entrypoints cannot drift despite a filtered SQL package', () => {
  const originals = inputs.smallerInputs.files;
  for (const files of [{ ...originals, '20261101000000_extra.sql': 'SELECT 1;' },
    Object.fromEntries(Object.entries(originals).slice(1)),
    { ...originals, [Object.keys(originals)[0]]: 'changed' }]) {
    assert.throws(() => buildAuthExactStagingManifest({ ...inputs, smallerInputs: { ...inputs.smallerInputs, files } }));
  }
  assert.throws(() => buildAuthExactStagingManifest({ ...inputs, smallerInputs: { ...inputs.smallerInputs,
    sourceFiles: { ...inputs.smallerInputs.sourceFiles, 'frontend/src/pages/AuthPage.tsx': 'changed' } } }), /inventory changed/);
});
test('substituting draft content independently from the bound text is rejected', () => {
  assert.throws(() => buildAuthExactStagingManifest({ ...inputs, smallerInputs: { ...inputs.smallerInputs,
    drafts: { ...inputs.smallerInputs.drafts, 'signup-access-draft.sql': 'UPDATE public.app_settings SET value = null;' } } }));
});
test('identical reviewed input produces deterministic held manifests', () => {
  assert.deepEqual(buildAuthExactStagingManifest(inputs), buildAuthExactStagingManifest(inputs));
  assert.equal(buildAuthExactStagingManifest(inputs).independentlyVerifiedConnection, false);
});