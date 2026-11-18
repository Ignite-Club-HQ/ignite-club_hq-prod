import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateTargets } from './messaging-upgrade-policy.mjs';
test('actual repository mappings bind Group 1 legacy and Group 2 to different chat canisters', () => {
  const root = new URL('../', import.meta.url);
  const shared = JSON.parse(readFileSync(new URL('deploy/mainnet/.icp/data/mappings/ic.ids.json', root)));
  const provision = JSON.parse(readFileSync(new URL('deploy/groups/g2/provision.json', root)));
  validateTargets([{ groupId: 'g1', name: 'messaging_domain', canisterId: shared.messaging_domain, subnetId: 'subnet', newHash: 'a'.repeat(64) },
    { groupId: 'g2', name: 'messaging_domain', canisterId: provision.canisters.messaging_domain, subnetId: 'subnet', newHash: 'a'.repeat(64) }]);
});
test('protected messaging workflow restores only existing pinned governor and check requires no upgrade confirmation', () => {
  const workflow = readFileSync(new URL('../.github/workflows/upgrade-messaging.yml', import.meta.url), 'utf8');
  const begin = workflow.indexOf('      - name: Restore existing governor only');
  const end = workflow.indexOf('      - name: Build only messaging recipe artifact', begin);
  assert.ok(begin >= 0 && end > begin, 'restore is a bounded protected workflow step');
  const restore = workflow.slice(begin, end);
  assert.match(workflow, /environment: group-2-admin-controls/);
  assert.match(workflow, /group: ignite-mainnet-governor-deployment/);
  assert.match(restore, /secrets\.GOVERNOR_PEM \|\| secrets\.DEPLOYER_PEM/);
  assert.match(restore, /PEM_IN="\$DEPLOYER_PEM" node scripts\/normalize-pem\.mjs/);
  assert.match(restore, /icp identity import --from-pem/);
  assert.match(restore, /icp identity principal --identity ignite-governor/);
  assert.match(restore, /vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae/);
  assert.doesNotMatch(restore, /identity new|sed -n|cycles mint|canister install/);
  assert.match(workflow, /if: inputs\.action == 'upgrade'/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /rm -f "\$RUNNER_TEMP\/chat\.pem"/);
});
