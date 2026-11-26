import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const club = readFileSync(new URL('../backend/club_domain/src/main.mo', import.meta.url), 'utf8');
const gate = readFileSync(new URL('../backend/shared/AccountAdmission.mo', import.meta.url), 'utf8');
const identity = readFileSync(new URL('../backend/identity_access/src/lib.rs', import.meta.url), 'utf8');
const methods = ['read_my_club_memberships_indexed', 'read_account_my_role_grants', 'read_account_my_clubs_and_roles_indexed'];
const between = (start, end) => {
  const i = club.indexOf(start);
  assert.ok(i >= 0, `Missing ${start}`);
  const j = club.indexOf(end, i + start.length);
  assert.ok(j > i, `Missing end of ${start}`);
  return club.slice(i, j);
};

test('only three caller-scoped first-content reads use the new path; generic admission is preserved', () => {
  assert.equal((club.match(/await admitAccountForFirstContent\(caller\);/g) ?? []).length, 3);
  for (const method of methods) {
    const body = between(`func ${method}(`, '\n  };');
    assert.match(body, /await admitAccountForFirstContent\(caller\);/);
    assert.match(body, /removalReceiver\.enter\(caller\)/);
  }
  assert.match(club, /func admitAccount\(subject : Principal\) : async \(\)/);
  const original = between('func admitAccount(subject : Principal)', 'func admitAccountForFirstContent(');
  assert.match(original, /await accountAdmission\.eligible\(subject\);/);
  assert.match(original, /await accountAdmission\.account\(subject\);/);
});

test('fast success uses the existing stronger trusted service-account proof, not a cached role', () => {
  const body = between('func admitAccountForFirstContent(', 'func denyLegacyAccountQuery(');
  assert.match(body, /if \(not accountAdmissionEnabled\) \{ await admitAccount\(subject\); return \}/);
  assert.match(body, /AccountProtection\.valid\(accountProtectionMode\)/);
  assert.match(body, /removalReceiver\.denied\(subject\)/);
  const legacyStart = body.indexOf('// Legacy fallback');
  const successful = body.slice(legacyStart, body.indexOf('case null {', legacyStart));
  assert.match(successful, /let account = await accountAdmission\.account\(subject\);/);
  assert.match(successful, /authority != accountAdmissionAuthority or epoch != membershipEpoch\(\)/);
  assert.match(successful, /AccountUnlinkFence\.rejects\(/);
  assert.match(successful, /linkedMembershipSnapshots\.add\(subject, \{ account = verified; observed = Time\.now\(\) \}\)/);
  assert.doesNotMatch(successful, /await accountAdmission\.eligible\(subject\)/);
  assert.match(gate, /read_service_account : shared \(Principal\)/);
  assert.match(gate, /if \(owns\(subject, a\)\) \?a else null/);
  assert.match(identity, /async fn read_service_account\(subject: Principal\)/);
  assert.match(identity, /production_service_account\(ic_cdk::api::msg_caller\(\),subject,false\)\.await/);
  assert.match(identity, /fn current_service_account\(subject: Principal\) -> Outcome<Account>/);
  assert.match(identity, /DELETION_TICKETS/);
});

test('fallback still requires fresh eligibility and rejects revoked or changed account authority', () => {
  const body = between('func admitAccountForFirstContent(', 'func denyLegacyAccountQuery(');
  const fallback = body.slice(body.indexOf('case null {', body.indexOf('// Legacy fallback')));
  assert.match(fallback, /await accountAdmission\.eligible\(subject\)/);
  assert.match(fallback, /authority != accountAdmissionAuthority/);
  assert.match(fallback, /epoch != membershipEpoch\(\)/);
  assert.match(fallback, /nameCleanup\.locked\(\)/);
  assert.match(fallback, /removalReceiver\.denied\(subject\)/);
  assert.match(fallback, /not eligible/);
  assert.match(fallback, /linkedMembershipSnapshots\.remove\(subject\)/);
  assert.match(gate, /func matches\(subject : Principal, evidence : Evidence\)/);
  assert.match(gate, /evidence\.account_version/);
  assert.match(gate, /version > denied/);
});

test('existing Identity reads remain available alongside combined member admission', () => {
  assert.match(gate, /read_member_admission : shared \(Principal\)/);
  assert.match(identity, /async fn read_member_admission\(subject: Principal\)/);
  assert.match(identity, /fn principal_eligibility\(subject: Principal\) -> PrincipalEligibility/);
  assert.match(identity, /async fn verify_member_reader\(caller:Principal,club_only:bool\)/);
});

test('combined proof verifies reader before reconstruction and fail-closed club admission', () => {
  const combined = between('func admitAccountForFirstContent(', 'func denyLegacyAccountQuery(');
  assert.match(combined, /await accountAdmission\.combined\(subject\)/);
  assert.match(club, /IGNITE_FIRST_CONTENT_COMBINED_ADMISSION/);
  assert.match(combined, /if \(combinedAdmissionEnabled\) await accountAdmission\.combined\(subject\) else null/);
  assert.match(combined, /AccountAdmission\.matches\(subject, proof\.eligibility\)/);
  assert.match(combined, /AccountAdmission\.owns\(subject, current\)/);
  assert.match(combined, /proof\.eligibility\.account_version != \?current\.version/);
  assert.match(combined, /AccountUnlinkFence\.rejects/);
  assert.match(combined, /case null \{\};[\s\S]*await accountAdmission\.account\(subject\)/);
  assert.match(gate, /with timeout = 10\) service\.read_member_admission\(subject\)/);
  assert.match(identity, /verify_member_reader\(caller, false\)\.await\?/);
  assert.match(identity, /verify_production_account_reader\(caller, false, &\[subject\]\)\.await\?/);
  assert.match(identity, /let eligibility = principal_eligibility\(subject\)/);
  assert.match(identity, /current_service_account\(subject\)\.ok\(\)/);
  assert.match(identity, /service_authorities\(\)\.contains\(&caller\)/);
});

test('one signed first-content RPC returns only currently authorised indexed clubs and roles', () => {
  const body = between('func read_account_my_clubs_and_roles_indexed(', 'public shared func read_account_has_club_staff_role(');
  const did = readFileSync(new URL('../backend/club_domain/club_domain.did', import.meta.url), 'utf8');
  assert.match(did, /read_account_my_clubs_and_roles_indexed: \(after: opt text, limit:\s+nat16\)/);
  assert.match(body, /await admitAccountForFirstContent\(caller\)/);
  assert.equal((body.match(/await /g) ?? []).length, 1, 'no second consensus read or service round trip');
  assert.match(body, /privateNameWriterGate\.enter\(\)/);
  assert.match(body, /removalReceiver\.enter\(caller\)/);
  assert.match(body, /removalReceiver\.leave\(caller\)/);
  assert.match(body, /membershipAliases\(caller\)/);
  assert.match(body, /MembershipIndex\.page\(/);
  assert.match(body, /live and isMember\(caller, club\)/);
  assert.match(body, /ownsMembershipPrincipal\(caller, grant\.user\)/);
  assert.match(body, /roleEffective\(grant\.club, grant\.team\)/);
  assert.match(body, /not isExcluded\(caller, club\)/);
  assert.match(body, /acl_revision = aclVersion; roles = roles/);
  assert.doesNotMatch(body, /http|fetch\(|Supabase|oauth|actor\(/i);
});
