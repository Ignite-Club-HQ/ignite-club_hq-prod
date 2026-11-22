import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const wf = readFileSync(new URL('../.github/workflows/report-prod-group-health.yml', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../frontend/scripts/report-group-health.ts', import.meta.url), 'utf8');

test('PROD health is manual, confirmed and prod-branch only', () => {
  assert.doesNotMatch(wf, /schedule:/);
  assert.match(wf, /test "\$CONFIRMATION" = 'REPORT PROD GROUP HEALTH'/);
  assert.match(wf, /refs\/heads\/prod/);
  assert.match(wf, /environment: production/);
});
test('PROD health uses the encrypted PROD key, never the DEV key, and removes it', () => {
  assert.match(wf, /secrets\.PROD_GOVERNOR_PEM_ENC/);
  assert.doesNotMatch(wf, /secrets\.(DEPLOYER_PEM|GOVERNOR_PEM)\b/);
  assert.match(wf, /trap 'rm -rf "\$KEY_DIR"' EXIT/);
  assert.match(wf, /IGNITE_ICP_ENV: prod/);
});
test('PROD runner uses PROD router and governor and refuses DEV canisters', () => {
  assert.match(runner, /PROD \? PROD_IDS\.shard_router : LIVE\.shard_router/);
  assert.match(runner, /PROD \? process\.env\.PROD_GOVERNOR_PRINCIPAL : DEV_GOVERNOR/);
  assert.match(runner, /lists a DEV canister/);
  assert.match(runner, /outside the PROD inventory/);
  assert.doesNotMatch(runner, /set_group_accepting|register_group/);
});
