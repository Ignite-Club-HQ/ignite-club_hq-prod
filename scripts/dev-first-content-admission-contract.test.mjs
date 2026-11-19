import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const club = readFileSync(new URL('../backend/club_domain/src/main.mo', import.meta.url), 'utf8');
const gate = readFileSync(new URL('../backend/shared/AccountAdmission.mo', import.meta.url), 'utf8');
const identity = readFileSync(new URL('../backend/identity_access/src/lib.rs', import.meta.url), 'utf8');
const methods = ['read_my_club_memberships_indexed', 'read_account_my_role_grants'];
const between = (start, end) => {
  const i = club.indexOf(start);
  assert.ok(i >= 0, `Missing ${start}`);
  const j = club.indexOf(end, i + start.length);
  assert.ok(j > i, `Missing end of ${start}`);
  return club.slice(i, j);
};

test('only two caller-scoped first-content reads use the new path; generic admission is preserved', () => {
  assert.equal((club.match(/await admitAccountForFirstContent\(caller\);/g) ?? []).length, 2);
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
  const successful = between('func admitAccountForFirstContent(', 'case null {');
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
  const fallback = body.slice(body.indexOf('case null {'));
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

test('no new Identity canister API is necessary or silently exposed', () => {
  assert.doesNotMatch(gate, /read_member_admission_snapshot/);
  assert.doesNotMatch(identity, /read_member_admission_snapshot/);
  assert.match(identity, /fn principal_eligibility\(subject: Principal\) -> PrincipalEligibility/);
  assert.match(identity, /async fn verify_member_reader\(caller:Principal,club_only:bool\)/);
});
