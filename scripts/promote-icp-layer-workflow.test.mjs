// Guards for the workflow that copies the canister layer into the live
// repository, and for the live release workflow's ability to run in a
// repository that keeps its web app outside the canister layer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(ROOT, '.github/workflows', file), 'utf8');
const copy = read('promote-icp-layer.yml');

test('the copy workflow is repository housekeeping, not a canister operation', () => {
  assert.match(copy, /^name: "\[REPO\] /m, 'must be tagged as repository housekeeping');
  // The whole point: this workflow moves files between repositories. It must
  // never hold a signing identity or talk to a canister.
  assert.doesNotMatch(copy, /icp identity|identity import|--pem-file|icp canister|icp deploy/, 'must not sign or call a canister');
  assert.doesNotMatch(copy, /ic\.ids\.json|deploy\/prod|deploy\/mainnet/, 'must not reference a canister table');
});

test('the copy workflow defaults to a plan that writes nothing', () => {
  assert.match(copy, /type: choice/);
  assert.match(copy, /default: plan/);
  assert.match(copy, /if: inputs\.mode != 'apply'/, 'the plan step must run unless the operator chose apply');
  assert.match(copy, /if: inputs\.mode == 'apply'/, 'the apply step must only run when chosen');
  assert.match(copy, /node scripts\/promote-icp-layer\.mjs\s*$/m, 'the plan run must carry no --apply flag');
  assert.match(copy, /node scripts\/promote-icp-layer\.mjs --apply/, 'apply must pass the flag explicitly');
});

test('overwriting differing live files needs an explicit drift choice', () => {
  assert.match(copy, /allow_drift:\n\s+description:.*\n\s+type: boolean\n\s+default: false/, 'drift overwrite must be an opt-in boolean, off by default');
  assert.match(copy, /if \[ "\$\{\{ inputs\.allow_drift \}\}" = "true" \]; then FLAG="--allow-drift"; fi/, 'the flag is passed only when the operator chose it');
  assert.doesNotMatch(copy, /promote-icp-layer\.mjs --apply --allow-drift/, 'apply must never carry the drift flag unconditionally');
});

test('the copy workflow authenticates with GitHub\'s own run credential', () => {
  // Source and destination are branches of this one repository, so the job's
  // per-run token is the right credential: no transfer token is stored here,
  // and the access expires when the run ends.
  assert.match(copy, /MIGRATION_GITHUB_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/, 'must authenticate with the per-run credential');
  assert.doesNotMatch(copy, /secrets\.MIGRATION_GITHUB_TOKEN/, 'must not depend on a stored transfer token this repository does not hold');
  assert.match(copy, /^permissions:\n  contents: write$/m, 'must be able to write the release branch of this repository');
});

test('the copy workflow only runs from the development branch', () => {
  assert.match(copy, /refs\/heads\/main/);
  assert.match(copy, /exit 1/, 'a run from another branch must stop');
});

test('the live release workflow can provision without a web-app layer', () => {
  const promote = read('promote-icp-prod.yml');
  // The live repository keeps its web app at its root, so the steps that belong
  // to the development layout must be skipped there rather than fail the run.
  assert.match(promote, /if \[ -f frontend\/package\.json \]; then node scripts\/ensure-frontend-deps\.mjs/, 'frontend dependency install must be conditional');
  assert.match(promote, /if \[ -f frontend\/scripts\/check-candid-drift\.mjs \]; then node frontend\/scripts\/check-candid-drift\.mjs/, 'interface drift check must be conditional');
  assert.match(promote, /id: webapp/, 'the workflow must record whether the web-app layer is present');
  assert.match(promote, /webapp: \$\{\{ steps\.webapp\.outputs\.present \}\}/, 'that fact must be a job output');
  assert.match(promote, /needs\.backend\.outputs\.webapp == 'true'/, 'the web-app publishing job must only run where the layer exists');
});

test('backend prod pushes never implicitly publish a frontend canister', () => {
  const promote = read('promote-icp-prod.yml');
  assert.match(promote, /push:\n\s+branches: \[prod\]/);
  assert.match(promote, /publish_frontend:[\s\S]*?default: false/);
  const frontend = promote.slice(promote.indexOf('\n  frontend:'));
  assert.match(frontend, /github\.event_name == 'workflow_dispatch' && inputs\.publish_frontend == true/);
  assert.match(frontend, /ref: \$\{\{ github.sha \}\}/);
  assert.doesNotMatch(frontend, /ref: prod|--mode auto|--mode reinstall|git push|git commit/);
  assert.match(frontend, /test -f deploy\/frontend-prod\/\.icp\/data\/mappings\/ic.ids.json/);
  assert.ok(frontend.indexOf('test -f deploy/frontend-prod') < frontend.indexOf('Restore the PROD governor'));
  assert.match(frontend, /icp deploy -e ic frontend --mode upgrade --yes/);
  assert.doesNotMatch(frontend, /canister start frontend -e ic \|\| true/);
});
