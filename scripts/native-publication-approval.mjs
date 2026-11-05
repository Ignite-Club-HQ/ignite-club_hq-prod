import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Store publication is a separate explicit decision, not a side effect of website promotion. */
export function assertNativePublicationApproval(env) {
  if (env.CM_BRANCH !== 'prod' || !/^[a-f0-9]{40}$/.test(env.CM_COMMIT ?? '')
    || env.NATIVE_APPROVED_COMMIT !== env.CM_COMMIT) {
    throw new Error('Native publication is held: approve this exact production commit separately before starting a store release.');
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { assertNativePublicationApproval(process.env); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}