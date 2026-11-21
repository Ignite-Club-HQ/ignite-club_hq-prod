import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const owner=read('frontend/src/live/devOwnerClubNameReadiness.ts');
const club=read('frontend/src/live/features/club.ts');
const membership=read('frontend/src/live/features/membership.ts');
const join=read('frontend/src/pages/JoinTeamPage.tsx');
const pii=read('frontend/src/live/privateProfileNames.ts');
const source=read('frontend/src/live/devCrossGroupTeamNameRoute.ts');

test('DEV-only, member-released, original-owner-signed name copy; no new cryptographic layer',()=>{
  assert.match(owner,/if \(!isExactDevG2NameTarget\(ctx\.target\)\) return 'not-applicable'/);
  assert.match(owner,/if \(!sharedClubNameEnforcementEnabled\(ctx\.target\)\) return 'pending-release'/);
  assert.match(owner,/await io\.readMember\(\)/);
  assert.match(owner,/parseExactOwnDevNameReference\(reference,principal\)/);
  assert.match(owner,/createDevCrossGroupTeamNameResolver\(ctx\)/);
  assert.match(owner,/refreshPrivateOwnClubNames\(source,name,async \(\) => \[clubId\],active\)/);
  assert.match(owner,/await opened\.confirm\(\)/);
  assert.match(owner,/uncertainWrites\.add\(key\)/);
  assert.match(owner,/uncertainWrites\.has\(key\) && !options\.explicitOwnerRetry/);
  assert.match(owner,/read_has_club_membership\(ctx\.identity\.getPrincipal\(\),club\)/);
  assert.match(source,/export function isExactDevG2NameTarget/);
  assert.match(pii,/if \(options\.scheduleBackfill !== false\) scheduleOwnClubNameBackfill/);
  assert.doesNotMatch(owner,/vetKdDeriveKey|register_pii\(|grantLivePiiRead|set_profile\(|register_conversion_name|supabase|sendNotification|localStorage/);
});

test('create club, accept parent/pending/shareable team and legacy team preserve original acknowledgement',()=>{
  for(const key of ['accept_parent_invite','accept_pending_invite','accept_team_invite_link','create_club']){
    assert.ok(club.includes(key),'Missing club original operation '+key);
  }
  for(const key of ['accept_team_invite','accept_pending_invite']){
    assert.ok(membership.includes(key),'Missing original membership operation '+key);
  }
  assert.match(club,/await afterConfirmedDevMembershipNameReadiness\(ctx,accepted\.club_id\)/);
  assert.match(club,/await afterConfirmedDevMembershipNameReadiness\(ctx,created\.id\)/);
  assert.match(membership,/await afterConfirmedDevMembershipNameReadiness\(ctx,accepted\.club_id\)/);
  assert.match(membership,/user\.toText\(\) === ctx\.identity\.getPrincipal\(\)\.toText\(\)/);
  assert.doesNotMatch(membership,/afterConfirmedDevMembershipNameReadiness\(ctx,user\.toText\(\)\)/);
});

test('join UI never re-submits an invitation to retry an encrypted-name copy',()=>{
  assert.match(join,/lastConfirmedDevOwnerNameReadiness\(ctx,inviteClubId\)/);
  assert.match(join,/reconcileConfirmedDevOwnerClubName\(ctx,inviteClubId,\{explicitOwnerRetry:true\}\)/);
  assert.match(join,/Secure club-name setup is pending/);
  assert.match(join,/Your membership is active/);
  const retry=join.slice(join.indexOf('onClick={() => void withFeatureBackend'));
  assert.ok(!retry.slice(0,620).includes('acceptLiveTeamInviteLink('));
  assert.ok(!retry.slice(0,620).includes('accept_pending_invite'));
});

test('normal PROD/email/Supabase and original name/key storage remain unchanged',()=>{
  assert.match(owner,/pending-release/);
  assert.match(owner,/pending-owner-check/);
  assert.match(owner,/pending-original-name/);
  assert.match(owner,/pending-source-verification/);
  assert.match(owner,/session-changed/);
  assert.doesNotMatch(owner,/forceIcp|setAuthMethodChoice|saveLiveRoleGrant|identity_link|new Account|window\.location/);
  assert.doesNotMatch(pii,/readPrivateOwnProfileName\(ctx: FeatureBackendContext, reference: string\): Promise<string> \{/);
});
