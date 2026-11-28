import { createHash } from 'node:crypto';

export const ADMISSION_CONFIRMATION = 'COMMISSION OPENCLOUD PROD ADMISSION';
const MEMBER_SERVICES = Object.freeze(['club_domain','events_domain','messaging_domain','vault_domain','competition_domain',
  'club_points_domain','mini_league_domain','media_metadata','insights_domain','notification_queue','pii_access_control','media_blob_store']);
const AUTHORITY = 'IGNITE_ACCOUNT_SERVICE_IDENTITY';
const ADMISSION = 'IGNITE_ACCOUNT_ADMISSION_RELEASE';
const REMOVAL = 'IGNITE_ACCOUNT_REMOVAL_RELEASE';
const REHEARSAL = 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL';

export function memberReaders(rows) {
  const readers = rows.filter(row => row.scope !== 'shared' && MEMBER_SERVICES.includes(row.service));
  if (rows.length !== 32 || readers.length !== 24 || new Set(readers.map(row => row.id)).size !== 24 ||
      !['g1','g2'].every(group => readers.filter(row => row.scope === group).length === 12) ||
      readers.some(row => !MEMBER_SERVICES.includes(row.service))) {
    throw Error('Exactly 24 distinct member readers across base and g2 required');
  }
  return readers.sort((a,b) => a.id.localeCompare(b.id));
}

export function admissionEnvironment(current, identity) {
  if (!Array.isArray(current)) throw Error('Current reader environment required');
  const vars = new Map(current.map(row => [row.name, row.value]));
  if (vars.size !== current.length) throw Error('Duplicate reader environment names');
  if (vars.get(REMOVAL) === '1' || vars.get(REHEARSAL) === '1') throw Error('Removal and rehearsal must remain off');
  if (vars.has(AUTHORITY) && vars.get(AUTHORITY) !== identity) throw Error('Foreign account authority');
  vars.set(AUTHORITY, identity);
  vars.set(ADMISSION, '1');
  return [...vars].map(([name,value]) => ({name,value})).sort((a,b) => a.name.localeCompare(b.name));
}

export function assertAdmissionEnvironment(current, identity) {
  const vars = new Map(current.map(row => [row.name,row.value]));
  if (vars.get(AUTHORITY) !== identity || vars.get(ADMISSION) !== '1' || vars.get(REMOVAL) === '1' || vars.get(REHEARSAL) === '1') {
    throw Error('Reader admission readback mismatch');
  }
}

export function planDigest({sourceCommit, registryRevision, modules, targets}) {
  const canonical = {
    purpose: 'OpenCloud PROD existing-account admission-only commissioning',
    sourceCommit, registryRevision: String(registryRevision),
    modules: modules.map(([id,hash]) => [id,String(hash)]).sort(),
    targets: targets.map(row => ({name:row.name,id:row.id,environment:admissionEnvironment(row.environment,row.identity)})),
    removalRelease: false, recoveryRelease: false, routingApproval: false, groupOpening: false,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** Never accept or emit Profile/display_name/ciphertext. Only diagnostic DTOs
 * returned by identity_access are summarized for the workflow artifact. */
export function sanitizeAccountDiagnostics(rows) {
  if (!Array.isArray(rows)) throw Error('Account diagnostics required');
  return rows.map(row => ({
    accountId: row.account_id,
    profilePresent: row.profile_present,
    opaqueNameReference: row.opaque_name_reference,
    encryptedNamePresence: row.presence.map(item => ({
      subject: item.subject.toText(), authority: item.authority.toText(),
      validOwnedCiphertext: item.valid_owned_ciphertext,
    })),
  }));
}
