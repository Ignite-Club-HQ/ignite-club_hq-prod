import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const YAML = require('yaml');
test('encrypted media execution is manual, main-only and has no deployment credentials', () => {
  const workflow = YAML.parse(readFileSync(new URL('../../.github/workflows/test-engine-encrypted-media.yml', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.permissions.contents, 'read');
  const job = workflow.jobs['isolated-media'];
  assert.equal(job.if, "github.ref == 'refs/heads/main'");
  assert.equal(job['runs-on'], 'ubuntu-24.04');
  assert.equal(job['timeout-minutes'], 20);
  const text = JSON.stringify(job);
  assert.equal(/secrets\.|DEPLOYER_PEM|PROD_|icp deploy|icp canister/.test(text), false);
});
test('candidate cryptographic checks bind the reviewed module fingerprints', () => {
  const pins = JSON.parse(readFileSync(new URL('./candidate-pins.json', import.meta.url)));
  assert.equal(pins.modules.pii_access_control, '35c7abe95c8fb3d09abc109fd90eaef5e72fde410e547872d1e89fe45c74158b');
  assert.equal(pins.modules.club_domain, '0e7df98ae95c334445edcbbb99f6be9add0d008fadda0beaedc0abf7e24e7ecd');
  assert.equal(pins.modules.media_blob_store, 'f822c1a3203abb301ea1e88e76a9e45379e05a99253861a799f5fa17c94b2835');
});