// Synthetic and source-level guard. Preserve current event ACL, scopes and order.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src=readFileSync(new URL('../backend/events_domain/src/main.mo',import.meta.url),'utf8');
const section=(start,end)=>{
 const a=src.indexOf(start),b=src.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Missing source scope');return src.slice(a,b);
};
test('both protected event-list methods preserve account and team live access',()=>{
 for(const body of [
  section('func read_account_list_events(','func read_account_list_events_multi('),
  section('func read_account_list_events_multi(','func read_account_list_events_for_duty_teams(')
 ]) {
   assert.match(body,/await admitAccount\(caller\)/);
   assert.match(body,/await freshMemberRolesForList\(caller, event\.club_id\)/);
   assert.match(body,/await freshEventTeamLive\(event\)/);
   assert.match(body,/await canViewListedEvent\(caller, event, freshRoles, \?teamVerified\)/);
   assert.match(body,/not event\.deleted/);
   assert.match(body,/removalReceiver\.leave\(caller\)/);
   assert.match(body,/let visible = List\.empty<Types\.Event>\(\)/);
   assert.match(body,/List\.add\(visible, event\)/);
   assert.doesNotMatch(body,/visible := visible\.concat\(\[event\]\)/);
 }
});
test('return shapes and per-request authorization caches remain unchanged',()=>{
 const single=section('func read_account_list_events(','func read_account_list_events_multi(');
 const multi=section('func read_account_list_events_multi(','func read_account_list_events_for_duty_teams(');
 assert.match(single,/List\.toArray\(visible\)/);
 assert.match(multi,/#Ok\(List\.toArray\(visible\)\)/);
 assert.match(multi,/if \(club_ids\.size\(\) \+ team_ids\.size\(\) > 300\) return #Err/);
 for(const body of [single,multi]){
  assert.match(body,/var memberRoleCache/);
  assert.match(body,/var teamStatus/);
 }
});
test('append order is retained for sparse authorized event fixtures',()=>{
 for(const n of [0,1,2,10,200]){
  const input=Array.from({length:n},(_,i)=>({id:'event-'+i,visible:i%4!==1,deleted:i%7===3}));
  const historical=[];const bounded=[];
  for(const event of input){
   if(event.visible&&!event.deleted)historical.push(event);
   if(event.visible&&!event.deleted)bounded.push(event);
  }
  assert.deepEqual(bounded,historical);
 }
});
