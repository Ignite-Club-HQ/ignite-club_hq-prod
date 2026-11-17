// Read-only structural regression: a disposable PocketIC behavior test remains
// required before approving a DEV canister upgrade.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const club=read('../backend/club_domain/src/main.mo');
const chat=read('../backend/messaging_domain/src/main.mo');
const events=read('../backend/events_domain/src/main.mo');
const section=(source,start,end)=>{
  const a=source.indexOf(start);assert.ok(a>=0,'missing '+start);
  const b=source.indexOf(end,a+start.length);
  assert.ok(b>a,'missing section terminator '+end);
  return source.slice(a,b);
};
test('only configured messaging service can request exact live-team access',()=>{
 const guard=section(club,'func read_account_read_competition_team_access(','func read_account_is_user_on_any_team(');
 assert.match(guard,/trustedCompetition\(caller\) or \(switch \(messagingDomainCanister\)/);
 assert.match(guard,/switch \(liveTeamClub\(team_id\)\)/);
 assert.match(guard,/isOnTeam\(user, team_id\) or isAdmin\(user, club\)/);
});
test('team chat checks canonical team authority, club scope and membership on every read/write',()=>{
 const helper=section(chat,'func requireChatTeamMember(','func requireChatAccess(');
 assert.match(helper,/read_account_read_competition_team_access\(team, subject\)/);
 assert.match(helper,/proof.club_id != \?club or not proof.is_member/);
 assert.match(helper,/configured != clubDomainCanister/);
 const gate=section(chat,'func requireChatAccess(','func requireMessageChatAccess(');
 assert.match(gate,/await\* requireChatClubMember\(subject, c.club_id\)/);
 assert.match(gate,/await\* requireChatTeamMember\(subject, c.club_id, team\)/);
 assert.match(section(chat,'func sendAs(','public shared',),/await\* requireChatAccess\(caller, conversation_id\)/);
});
test('protected event feeds do not trust stale local roles or include soft-deleted team events',()=>{
 const handler=section(events,'func canViewListedEvent(','public shared ({ caller }) func read_account_list_events(');
 assert.match(handler,/await freshEventTeamLive\(event\)/);
 assert.doesNotMatch(handler,/if \(canView\(subject, event\)\) return true/);
 const team=section(events,'func freshEventTeamLive(','func canViewListedEvent(');
 assert.match(team,/club.get_team\(teamId\)/);
 assert.match(team,/t.club_id == event.club_id and t.deleted_at_ms == null/);
 for(const [start,end] of [
  ['func read_account_list_events(','func read_account_list_events_multi('],
  ['func read_account_list_events_multi(','func read_account_list_events_for_duty_teams(']
 ]){
  const body=section(events,start,end);
  assert.match(body,/await freshMemberRolesForList\(caller, event.club_id\)/);
  assert.doesNotMatch(body,/if \(canView\(caller, event\)\) null else/);
  assert.match(body,/await canViewListedEvent\(caller, event, freshRoles\)/);
 }
});
