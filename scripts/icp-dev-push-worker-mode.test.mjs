import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertLegacyDevPushAllowed } from './icp-dev-push-worker-mode.mjs';
test('legacy TEST runner remains unchanged until explicitly handed over', () => {
  assert.doesNotThrow(() => assertLegacyDevPushAllowed({}));
  assert.doesNotThrow(() => assertLegacyDevPushAllowed({ ICP_DEV_PUSH_HANDOVER: 'false' }));
});
test('legacy TEST runner refuses every execution after handover', () => {
  assert.throws(() => assertLegacyDevPushAllowed({ ICP_DEV_PUSH_HANDOVER: 'true' }), /retired/);
});