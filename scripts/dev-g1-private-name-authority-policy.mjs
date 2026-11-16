/**
 * Pure, privacy-safe interpretation of governor-only DEV original G1 PII
 * management settings. This does NOT attest original historical vetKey
 * continuity or grant a private display-name audience.
 *
 * Values from management canister_status are never copied into the report.
 */
const isText = s => typeof s === 'string' && s.length > 0;
const isSha256 = s => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
function onlyValue(rows, name) {
  if (!Array.isArray(rows)) throw new Error('Expected bounded management settings');
  const hits = rows.filter(x => x && x.name === name);
  if (hits.length > 1) throw new Error('Duplicate protected PII setting');
  return hits.length ? hits[0].value : undefined;
}
export function assessOriginalG1PiiAuthority(input) {
  const {expected, governor, controllers, environment, opening, publicKeySha256, previousReadSha256} = input ?? {};
  if (!expected || ![expected.identity,expected.originalClub,expected.originalPii,governor].every(isText) ||
      !Array.isArray(controllers) || !controllers.every(isText) ||
      !Array.isArray(opening) || !Array.isArray(environment) ||
      !isSha256(publicKeySha256) || !isSha256(previousReadSha256)) {
    throw new Error('Exact pinned DEV G1 authority and public-key evidence required');
  }
  if (environment.length > 128 || opening.length > 32 || controllers.length > 20 ||
      environment.some(x => !x || !isText(x.name) || typeof x.value !== 'string') ||
      opening.some(x => !Array.isArray(x) || x.length !== 2 || !isText(x[0]) || typeof x[1] !== 'string')) {
    throw new Error('Unexpected or unbounded original PII management shape');
  }
  const openRows=opening.map(([name,value])=>({name,value}));
  const samePreviousKey = publicKeySha256 === previousReadSha256;
  const governorControllerPresent = controllers.includes(governor);
  const identityVerifierPinned = onlyValue(environment, 'IGNITE_PRIVATE_PROFILE_IDENTITY') === expected.identity;
  const immutableKeyNamePresent = onlyValue(environment, 'VETKD_KEY_NAME') === 'key_1';
  const sourceClubPinned = onlyValue(openRows, 'club_domain') === expected.originalClub;
  const privateProfileRehearsalDisabled = onlyValue(environment, 'IGNITE_PRIVATE_PROFILE_READS_REHEARSAL') !== '1';
  const privateClubDisplaySwitchEnabled = onlyValue(environment, 'IGNITE_PRIVATE_CLUB_NAME_DISPLAY_RELEASE') === '1';
  const originalAuthoritySettingsMatch =
    governorControllerPresent && identityVerifierPinned && immutableKeyNamePresent &&
    sourceClubPinned && privateProfileRehearsalDisabled;
  return {
    originalPiiCanister:expected.originalPii,
    previouslyObservedKeyMatches:samePreviousKey,
    previousKeyObservationRun:'43785400907',
    governorControllerPresent,
    identityVerifierPinned,
    immutableKeyNamePresent,
    originalGroup1ClubPinned:sourceClubPinned,
    privateProfileRehearsalDisabled,
    originalPiiDisplaySwitchEnabled:privateClubDisplaySwitchEnabled,
    originalAuthoritySettingsMatch,
    // Comparing two readbacks on 16 November is not an independently archived
    // historical baseline, proof of Identity service allowlist, or same-team ACL.
    historicalOriginalKeyContinuityVerified:false,
    completeIdentityLegacyPiiAllowlistVerified:false,
    exactTeamNameAudienceReleased:false,
    nameReadAuthorised:false,
    readyToReleaseName:false,
  };
}
