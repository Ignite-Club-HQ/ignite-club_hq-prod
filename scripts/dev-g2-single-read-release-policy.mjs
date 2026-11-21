/** Exact DEV Group 2 single-read release, preserving the existing G2-only governor and journal rules. */
export {
  TARGET, validateTarget, validateRegistration, validateJournal, executeUpgrade,
} from './g2-club-roster-release-policy.mjs';

export const PREVIOUS_MODULE_HASH = '2a2361a11b76075d6cf9567e9667f72839ee5fe56ed0f23dd1d85860d171062f';
export const PREVIOUS_RELEASE_SOURCE = '51bb9578ec7888acf21dddcdfc488eb6580d1408';
export const CONFIRMATION = 'UPGRADE DEV G2 SINGLE READ ONLY';
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;

export function validateRequest({action,confirmation='',release='',actualCommit='',oldHash='',candidateHash='',expectedCandidateHash=''}) {
  if (!['check','upgrade'].includes(action)) throw Error('Use check or upgrade only');
  if (action === 'check') {
    if (confirmation || release || oldHash || expectedCandidateHash) throw Error('Check must have empty approval fields');
    return;
  }
  if (confirmation !== CONFIRMATION) throw Error('Exact DEV G2 single-read confirmation required');
  if (!SHA.test(release) || release !== actualCommit) throw Error('Reviewed main source SHA mismatch');
  if (oldHash !== PREVIOUS_MODULE_HASH) throw Error('DEV G2 Club current module drift from verified prior stage');
  if (!HASH.test(candidateHash) || candidateHash === oldHash || expectedCandidateHash !== candidateHash)
    throw Error('Missing or changed checked candidate WASM hash');
}
