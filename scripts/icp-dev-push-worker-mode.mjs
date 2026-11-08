// No provider calls. Explicitly refuses legacy execution after TEST handover.
export function assertLegacyDevPushAllowed(env) {
  // PROD reuses the delivery implementation only after its own strict validator.
  // TEST handover must never change that independently approved path.
  if (env.GITHUB_REF === 'refs/heads/prod' && env.IGNITE_ICP_ENV === 'prod') return;
  if (env.ICP_DEV_PUSH_HANDOVER === 'true') throw new Error('Legacy TEST push delivery is retired for handover');
}