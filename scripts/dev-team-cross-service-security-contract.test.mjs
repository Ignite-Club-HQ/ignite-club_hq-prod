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
  assert.match(body,/await canViewListedEvent\(caller, event, freshRoles, \?teamVerified\)/);
  assert.match(body,/teamStatus\.find\(/,'Team live proof must be cached per request');
 }
});

test('chat first-page composite query cannot bypass deleted-team authority',()=>{
  const query=section(chat,'func open_conversation_query(','// Call only after the opening endpoint');
  assert.match(query,/read_competition_team_access\(team, caller\)/);
  assert.match(query,/proof.club_id != \?c.club_id or not proof.is_member/);
  assert.match(query,/clubDomainCanister != \?cd/);
  const proof=section(club,'func read_competition_team_access(','func is_user_on_any_team(');
  assert.match(proof,/trustedCompetition\(caller\) or \(switch \(messagingDomainCanister\)/);
  assert.match(proof,/switch \(liveTeamClub\(team_id\)\)/);
});

test('event team-settings and active-game endpoints revoke access when team is deleted',()=>{
  const helper=section(events,'func freshTeamOnlyReadAllowed(','func freshVisibleEvent(');
  assert.match(helper,/cd.get_team\(team\)/);
  assert.match(helper,/t.deleted_at_ms != null/);
  assert.match(helper,/freshTeamReadAllowed\(subject, t.club_id, team\)/);
  for(const [start,end] of [
    ['func read_account_get_pitch_board_settings(','func read_account_get_game_summary('],
    ['func read_account_get_active_game(','func read_account_list_event_views('],
    ['func read_account_get_playhq_team_sync(','func read_account_get_event_duty_team('],
  ]){
    const body=section(events,start,end);
    assert.match(body,/await freshTeamOnlyReadAllowed\(caller,/);
  }
  const viewed=section(events,'func read_account_list_my_viewed_event_ids(','func read_account_check_event_membership(');
  assert.match(viewed,/event_ids.size\(\) > 300/);
  assert.match(viewed,/await freshVisibleEventIds\(caller, event_ids\)/);
});

test('event search, recurring schedules and duty-team events require current club authority',()=>{
  const search=section(events,'func read_account_execute(','func read_account_list_association_events(');
  assert.match(search,/await freshOqlVisibleEvents\(caller\)/);
  assert.doesNotMatch(search,/canView\(caller, event\)/);
  const recurring=section(events,'func read_account_list_series(','func read_account_get_lineup_snapshot(');
  assert.match(recurring,/await freshSeriesVisible\(caller, item\)/);
  const duties=section(events,'func read_account_list_events_for_duty_teams(','func read_account_get_event_rosters(');
  assert.match(duties,/await freshVisibleEventIds\(caller, candidates.map/);
  assert.doesNotMatch(duties,/canView\(caller, event\)/);
});

test('secondary event reads reject stale team roles and unauthorized membership probes',()=>{
  const assoc=section(events,'func read_account_list_association_events(','func read_account_get_event_child(');
  assert.match(assoc,/await freshMemberRolesForList\(caller, association_id\)/);
  assert.doesNotMatch(assoc,/hasRole\(caller, "club_admin"/);
  const pauses=section(events,'func read_account_list_team_training_pauses(','func read_account_is_paused(');
  const paused=section(events,'func read_account_is_paused(','func read_account_is_team_member(');
  assert.match(pauses,/await freshTeamReadAllowed\(caller, club_id, team_id\)/);
  assert.match(paused,/await freshTeamReadAllowed\(caller, club_id, team_id\)/);
  const probe=section(events,'func read_account_check_event_membership(','func read_account_get_playhq_config_status(');
  assert.match(probe,/await freshVisibleEvent\(caller, event\)/);
  const stats=section(events,'func read_account_get_player_stats_report(','func read_account_get_active_game(');
  assert.match(stats,/await freshMemberRolesForList\(caller, club_id\)/);
  assert.match(stats,/await freshEventTeamLive\(e\)/);
  assert.doesNotMatch(stats,/managesTeam\(caller, club_id/);
});

test('protected batch event and roster readers reuse canonical live team status',()=>{
  const guard=section(events,'func canViewListedEvent(','func freshOqlVisibleEvents(');
  assert.match(guard,/case \(\?verified\) verified/);
  assert.match(guard,/await freshEventTeamLive\(event\)/);
  const batched=section(events,'func freshVisibleEventIds(','func freshManageEvent(');
  assert.match(batched,/var teamStatus : \[\(Text, Text, Bool\)\]/);
  assert.match(batched,/await freshEventTeamLive\(event\)/);
  assert.match(batched,/canViewListedEvent\(subject, event, roles, \?teamVerified\)/);
});
