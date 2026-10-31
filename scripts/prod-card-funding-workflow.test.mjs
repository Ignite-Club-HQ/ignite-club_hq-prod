import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const workflow = readFileSync(new URL('../.github/workflows/fund-prod-canisters-by-card.yml', import.meta.url), 'utf8');
const runner = readFileSync(new URL('./prod-card-funding.mjs', import.meta.url), 'utf8');

test('PROD card funding is manual, serialized, pinned and only ever temporary signing material', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /schedule:/);
  assert.match(workflow, /group: ignite-prod-governor-deployment/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /icp-cli@1\.7\.0/);
  assert.match(workflow, /trap 'rm -rf "\$ICP_HOME"' EXIT/);
  assert.match(workflow, /cd "\$RUNNER_TEMP"/);
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/prod"/);
});

test('the PROD order is signed only by the PROD governor, never a DEV key', () => {
  assert.match(workflow, /secrets\.PROD_GOVERNOR_PEM_ENC/);
  assert.match(workflow, /secrets\.PROD_GOVERNOR_PASSPHRASE/);
  assert.match(workflow, /assertGovernor\('prod'/);
  assert.doesNotMatch(workflow, /secrets\.DEPLOYER_PEM|secrets\.GOVERNOR_PEM\b|secrets\.IGNITE_LIVE/);
  assert.match(runner, /expectedPrincipal: process\.env\.PROD_GOVERNOR_PRINCIPAL/);
  assert.match(runner, /--identity', identity/);
});

test('order intent is journaled before the order exists and the link is not rewritten', () => {
  assert.match(runner, /state\.phase = 'creating-order';\s*save\(\);\s*const child = spawn/);
  assert.match(runner, /assertNoOpenProdPayment/);
  assert.match(runner, /Payment ID already exists/);
  assert.match(runner, /'--cycles', plan\.shortfallCycles/);
  assert.match(runner, /'--gateway', PROD_CARD_GATEWAY, '--no-open'/);
  assert.match(runner, /PAY BY CARD: \$\{message\.checkout_url\}/);
  assert.match(runner, /state\.balanceAfter = balance\(\)\.toString\(\)/);
  assert.match(runner, /state\.phase !== 'delivered'/);
});

test('funding never touches a canister: no create, no top-up, no deploy', () => {
  assert.doesNotMatch(workflow, /icp deploy|canister create|top-up|--amount|deploy\/prod\/icp\.yaml/);
  assert.doesNotMatch(runner, /'canister'|top-up|--amount|'deploy'|install/);
});
