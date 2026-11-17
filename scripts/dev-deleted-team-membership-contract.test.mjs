import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const main = readFileSync(new URL('../backend/club_domain/src/main.mo', import.meta.url), 'utf8');
function body(start, end) {
  const from = main.indexOf(start);
  assert.ok(from >= 0, 'Missing security entrypoint: ' + start);
  const until = end ? main.indexOf(end, from + start.length) : -1;
  assert.ok(!end || until > from, 'Missing security boundary: ' + end);
  return main.slice(from, until < 0 ? undefined : until);
}

test('canonical soft-delete tombstone overrides legacy ACL mirror, including family-derived membership', () => {
  const live = body('func liveTeamClub(', 'public shared query ({ caller }) func read_competition_team_access');
  assert.match(live, /teams\.find\(func\(t\) = t\.id == teamId\)/);
  assert.match(live, /deleted_at_ms == null/);
  assert.match(live, /case \(\?t\) if \(t\.deleted_at_ms == null\) \?t\.club_id else null/);
  const scope = body('func roleEffective(', '// A parent or guardian');
  assert.match(scope, /case \(\?c\) liveTeamClub\(id\) == \?c/);
  assert.match(body('func teamInClub(', '// Caller belongs to'), /liveTeamClub\(teamId\) == \?club/);
  assert.match(body('func isOnTeam(', 'func trustedCompetition('), /if \(liveTeamClub\(teamId\) == null\) return false/);
  assert.match(body('func isMember(', 'func isAdmin('), /roleEffective\(grant\.club, grant\.team\)/);
});

test('soft deleting only this team removes both authority and roster grants; no identities/children are erased', () => {
  const del = body('func soft_delete_team(', 'func restore_team(');
  assert.match(del, /roles = acl\.roles\.filter\(func\(g\) = g\.team != \?id\)/);
  assert.match(del, /accountRoles := accountRoles\.filter\(func\(g\) = g\.team != \?id\)/);
  assert.match(del, /if \(team\.deleted_at_ms == null\)/);
  assert.doesNotMatch(del, /eraseMembership|erase_account|delete_own_child|acl\.children :=|accounts :=|identityAccessCanister :=/);
  const grant = body('func add_role_grant(', 'func remove_role_grant(');
  assert.match(grant, /not inviteTeamValid\(club, id\)/);
});

test('consensus and legacy membership, PII audience and sibling role reads use live-team scope', () => {
  for (const [a,b] of [
    ['func has_club_staff_role(', 'func is_club_member('],
    ['func read_account_has_club_staff_role(', 'func read_account_is_club_member('],
    ['func list_user_club_roles(', 'func is_app_admin('],
    ['func read_account_list_user_club_roles(', 'func read_account_is_app_admin('],
    ['func read_has_pii_audience(', 'func read_profile_candidates('],
    ['func list_role_grants(', 'func list_team_role_grants('],
    ['func read_account_list_role_grants(', '// Team roster IDs'],
    ['func get_club_roster(', '// Caller-scoped:'],
    ['func read_account_get_club_roster(', 'func read_account_list_children('],
  ]) assert.match(body(a,b), /roleEffective\(/, 'Live-team gate missing in ' + a);
  assert.match(body('func teamClub(', 'func list_pitch_formations('), /liveTeamClub\(team_id\)/);
});

test('club-team role listings do not expose deleted team or role grants', () => {
  for (const [a,b] of [
    ['func list_team_role_grants(', '// Caller-scoped:'],
    ['func read_account_list_team_role_grants(', 'func read_account_my_role_grants('],
  ]) {
    const src = body(a,b);
    assert.match(src, /let club = liveTeamClub\(team\)/);
    assert.match(src, /roleEffective\(grant\.club, grant\.team\)/);
  }
  assert.match(body('func clubChatParticipants(', 'func teamChatParticipants('), /roleEffective\(grant\.club, grant\.team\)/);
  assert.match(body('func teamChatParticipants(', 'func fanOutEnsureConversation('), /roleEffective\(grant\.club, grant\.team\)/);
});

test('membership source export never publishes deleted-team roles or family membership', () => {
  const source = body('func membershipSourcePage(', 'public shared ({ caller }) func read_membership_source_page(');
  assert.match(source, /if \(roleEffective\(g\.club, g\.team\)\)/);
  assert.match(source, /if \(liveTeamClub\(team\) == null\) null else \?#ChildTeam/);
  assert.match(source, /deleted = liveTeamClub\(t\.id\) != \?t\.club/);
});
