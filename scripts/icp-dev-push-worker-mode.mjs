// No provider calls. Explicitly refuses legacy execution after TEST handover.
export function assertLegacyDevPushAllowed(env) {
  if (env.ICP_DEV_PUSH_HANDOVER === 'true') throw new Error('Legacy TEST push delivery is retired for handover');
}