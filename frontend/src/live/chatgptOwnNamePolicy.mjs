/**
 * DEV-only secure-name preparation for an in-ChatGPT client-side encryption view.
 * Mirrors frontend/src/live/privateProfileNames.ts + piiVetKeys.ts.
 *
 * This module performs NO canister calls, carries NO credentials, and MUST NOT
 * be used as a server-side plaintext profile-name writer.
 */
export const DEV_CHATGPT_PRIVATE_NAME = Object.freeze({
  appUrl: 'https://ignite-club-launchpad.lovable.app',
  derivationOrigin: 'https://proe7-kqaaa-aaaas-qg6gq-cai.ic0.app',
  piiAuthority: 'iui5p-aaaaa-aaaal-qxllq-cai',
  identityAccess: 'mq2sj-fiaaa-aaaal-qxlqa-cai',
  fieldId: 'display_name',
  referencePrefix: 'pii-display-name:v1:',
});

const encoder = new TextEncoder();

export function validateDevOwnNamePreparation(args) {
  if (!args || args.appUrl !== DEV_CHATGPT_PRIVATE_NAME.appUrl ||
      args.derivationOrigin !== DEV_CHATGPT_PRIVATE_NAME.derivationOrigin)
    throw Error('Verified DEV app and derivation origin required');
  if (args.piiAuthority !== DEV_CHATGPT_PRIVATE_NAME.piiAuthority ||
      args.identityAccess !== DEV_CHATGPT_PRIVATE_NAME.identityAccess)
    throw Error('Verified DEV original PII and identity authority required');
  const { callerPrincipal, verifiedPrincipal, canonicalPrincipal } = args;
  if (typeof canonicalPrincipal !== 'function')
    throw Error('Canonical principal validator required');
  if (typeof callerPrincipal !== 'string' || callerPrincipal !== verifiedPrincipal ||
      !callerPrincipal || canonicalPrincipal(callerPrincipal) !== callerPrincipal)
    throw Error('The signed DEV caller must match the exact name subject');
  if (typeof args.displayName !== 'string') throw Error('Display name required');
  const name = args.displayName.trim();
  if (!name || [...name].length > 80 || encoder.encode(name).length > 512 ||
      [...name].some(ch => { const code = ch.codePointAt(0); return code < 32 || code === 127; }))
    throw Error('Display name must be 1-80 characters without control characters');
  return Object.freeze({
    subject: callerPrincipal,
    name,
    fieldId: DEV_CHATGPT_PRIVATE_NAME.fieldId,
    reference: DEV_CHATGPT_PRIVATE_NAME.referencePrefix + args.piiAuthority + ':' + callerPrincipal,
    ibeIdentity: encoder.encode(callerPrincipal + '\u001f' + DEV_CHATGPT_PRIVATE_NAME.fieldId),
  });
}

export function validateReadback(preparation, confirmed) {
  if (!preparation || !confirmed || preparation.subject !== confirmed.subject ||
      preparation.fieldId !== confirmed.fieldId ||
      preparation.reference !== confirmed.reference)
    throw Error('Secure name verification targeted another subject or authority');
  if (confirmed.plaintext !== preparation.name)
    throw Error('Verified own VetKey decryption did not match the approved display name');
  if (confirmed.publishedProfileReference !== preparation.reference)
    throw Error('The authenticated profile did not publish the original secure-name reference');
  return true;
}
