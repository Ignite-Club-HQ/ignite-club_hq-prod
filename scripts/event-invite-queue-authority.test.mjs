// Narrow source-contract checks; actual Motoko authorization and event routing
// are covered by the disposable three-canister PocketIC test.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = x => readFileSync(new URL('../'+x,import.meta.url),'utf8');
const queue=read('backend/notification_queue/src/main.mo');
const club=read('backend/club_domain/src/main.mo');
const events=read('backend/events_domain/src/main.mo');
const notifications=read('frontend/src/live/features/notifications.ts');
const browser=read('frontend/src/hooks/useEventReminderMutations.ts');
const access=read('backend/notification_queue/src/updateReminderAccess.mo');
const section=(a,b)=>{
 const i=queue.indexOf(a);const j=queue.indexOf(b,i);
 assert.ok(i>0&&j>i, 'missing queue scope: '+a);
 return queue.slice(i,j);
};
const enqueue=section('public shared ({ caller }) func enqueue(', 'public shared ({ caller }) func fan_out(');
const fan=section('public shared ({ caller }) func fan_out(', 'public shared ({ caller }) func enqueue_competition_broadcast(');

test('event_invite requires currently trusted club domain, not messaging or governor',()=>{
 assert.match(queue,/func eventInviteSourceAllowed\(kind : Text, caller : Principal\) : Bool \{\s*kind != "event_invite" or clubDomainCanister == \?caller/);
 for (const source of [enqueue,fan]){
   assert.equal(source.match(/if \(not eventInviteSourceAllowed\(kind, caller\)\) return #Err/g)?.length,2,
     'both early pre-admission and final pre-persist checks needed');
   assert.ok(source.indexOf('eventInviteSourceAllowed(kind, caller)')<source.indexOf('await admitAccount(caller)'),
     'privileged check must be before any caller admission await');
   assert.ok(source.lastIndexOf('eventInviteSourceAllowed(kind, caller)')>source.indexOf('if (isFenced(club)) return #Err("Notification scope changed")'),
     'revalidate authority after all cross-canister awaits');
 }
 assert.ok(enqueue.lastIndexOf('eventInviteSourceAllowed(kind, caller)')<enqueue.indexOf('switch (get(id))'));
 assert.ok(fan.lastIndexOf('eventInviteSourceAllowed(kind, caller)')<fan.indexOf('items := items.concat([notification])'));
});

test('official event invitation still goes through the club authority',()=>{
 assert.match(events,/service\.relay_event_notice\(users, event\.club_id, kind, body, key, event\.id\)/);
 assert.match(club,/if \(eventsDomainCanister != \?caller\) return #Err\("Events authority required"\)/);
 assert.match(club,/queue\.fan_out\(users, club, kind, body, key, \?event_id\)/);
 assert.match(browser,/notifyLiveEventAudience\(ctx, id, 'event_invite'\)/);
});

test('other notification types are not subject to the new event invite gate',()=>{
 assert.match(access,/Text\.startsWith\(kind, #text "update_reminder"\)/);
 assert.match(queue,/kind != "event_invite" or clubDomainCanister == \?caller/);
 assert.match(notifications,/actor\.enqueue\(/);
 assert.match(notifications,/actor\.fan_out\(/);
 assert.doesNotMatch(queue,/kind == "event_invite" or kind == "event_reminder"/);
});
