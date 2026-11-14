// This test runs ONLY against a disposable PocketIC replica. The deliberately
// mainnet-looking addresses are allocated inside PocketIC with targetCanisterId.
// There is no network agent, real device token, push worker or live notification.
// A PASS verifies the exact deployed-source authorization path in a replica,
// NOT delivery to Test2's actual phone.
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as queueIdl } from '../src/lab/bindings/notification_queue/declarations/notification_queue.did.js';

const principal = n => Principal.fromUint8Array(Uint8Array.of(n, 1));
const governor = principal(1), outsider = principal(2), otherAdmin = principal(3);
const test2 = Principal.fromText('pfslb-rpozk-543m5-zll3a-a3ay4-rdg3b-elojg-ukmfs-e624l-6rjyp-jae');
const clubCanisterId = Principal.fromText('yfwyv-nyaaa-aaaal-qxpyq-cai');
const queueCanisterId = Principal.fromText('zu4gk-vqaaa-aaaal-qxp5a-cai');
const clubId = '70eccd5e-28cd-54b5-9bbd-d0dc74eea9ca';
const teamId = 'ef943494-1c7f-58e3-a28d-db39e545319f';
const eventId = 'evt-70eccd5e-28cd-54b5-9bbd-d0dc74eea9ca-1';
const otherEvent = 'evt-70eccd5e-28cd-54b5-9bbd-d0dc74eea9ca-2';
const ok = value => {
  assert.ok(value && 'Ok' in value,
    'Expected Ok, got ' + JSON.stringify(value, (_, n) => typeof n === 'bigint' ? String(n) : n));
  return value.Ok;
};
const denied = value => assert.ok(value && 'Err' in value, 'Denied request unexpectedly succeeded');
const option = value => ok(value);

const optionalTeamFields = ['age_group','deleted_at_ms','description','division','folder_id',
  'gender','logo_url','playhq_competition_id','playhq_team_id','shell_claim_token',
  'shell_claimed_at_ms','shell_claimed_by','shell_contact_email',
  'shell_contact_name','shell_invited_by','team_type'];
const teamInput = () => {
  const row = {
    id: teamId, club_id: clubId, name: 'Disposable Test3 Starter Team',
    archived: false, is_active: true, is_shell: false,
    playhq_auto_create_events: false
  };
  for (const field of optionalTeamFields) row[field] = [];
  return row;
};

assert.ok(process.env.CLUB_DOMAIN_WASM && process.env.NOTIFICATION_QUEUE_WASM,
  'Two locally built canister WASM files are required; never fetch remote WASM');
const server = await PocketIcServer.start();
let pic;
try {
  pic = await PocketIc.create(server.getUrl(), {processingTimeoutMs: 90_000});
  const arg = IDL.encode([IDL.Principal], [governor]);
  const club = await pic.setupCanister({
    idlFactory: clubIdl, wasm: process.env.CLUB_DOMAIN_WASM,
    targetCanisterId: clubCanisterId, sender: governor,
    controllers: [governor], arg
  });
  const queue = await pic.setupCanister({
    idlFactory: queueIdl, wasm: process.env.NOTIFICATION_QUEUE_WASM,
    targetCanisterId: queueCanisterId, sender: governor,
    controllers: [governor], arg
  });
  assert.equal(club.canisterId.toText(), clubCanisterId.toText());
  assert.equal(queue.canisterId.toText(), queueCanisterId.toText());
  const c = club.actor, q = queue.actor;

  // Exact canister pair exists solely on this disposable replica.
  c.setPrincipal(governor);
  ok(await c.set_notification_queue_canister(queueCanisterId));
  q.setPrincipal(governor);
  ok(await q.set_club_domain_canister(clubCanisterId));

  c.setPrincipal(governor);
  ok(await c.create_club(clubId, 'Disposable Test3 Starter Club', 'pocketic-only-test3', [], ['soccer']));
  ok(await c.save_team(teamInput()));
  ok(await c.add_role_grant(test2, clubId, 'parent', [teamId]));
  assert.deepEqual(await c.read_account_list_user_club_roles(test2, clubId), [['parent', [teamId]]]);

  // Correct signed principal and Parent role, but no matching queue row yet.
  c.setPrincipal(test2);
  assert.deepEqual(option(await c.read_account_my_dev_test2_event_delivery(eventId)), [],
    'Missing notification must return null without exposing inbox inventory');

  // A different signed identity, including the club admin, cannot read it.
  for (const caller of [outsider, governor, otherAdmin]) {
    c.setPrincipal(caller);
    denied(await c.read_account_my_dev_test2_event_delivery(eventId));
  }
  c.setPrincipal(test2);
  denied(await c.read_account_my_dev_test2_event_delivery(otherEvent));
  denied(await c.read_account_my_dev_test2_event_delivery(''));

  // The queue's new method cannot be called directly by an inbox owner or admin.
  for (const caller of [test2, outsider, governor]) {
    q.setPrincipal(caller);
    denied(await q.read_trusted_dev_test2_event_delivery(eventId, test2));
    denied(await q.read_trusted_dev_test2_event_delivery(otherEvent, test2));
    denied(await q.read_trusted_dev_test2_event_delivery(eventId, outsider));
  }

  // An unrelated event_invite row sharing the event ID must NOT be
  // interpreted as evidence that the event-domain workflow queued its invite.
  // This synthetic row is not sent to any device or network.
  q.setPrincipal(governor);
  assert.equal(ok(await q.fan_out([test2.toText()], clubId, 'event_invite',
    'Noncanonical fixture only', 'pocketic-unrelated-invite', [eventId])), 1);
  c.setPrincipal(test2);
  assert.deepEqual(option(await c.read_account_my_dev_test2_event_delivery(eventId)), [],
    'Wrong-key event notification must be ignored, not misreported as queued');

  // The real events-domain workflow uses this canonical key/id convention.
  // This fixture seeds a local queue row, not a real trusted event-domain send.
  q.setPrincipal(governor);
  assert.equal(ok(await q.fan_out([test2.toText()], clubId, 'event_invite',
    'Canonical fixture only, no device delivery', `event_invite-${eventId}-invite`, [eventId])), 1);
  c.setPrincipal(test2);
  const status = option(await c.read_account_my_dev_test2_event_delivery(eventId));
  assert.equal(status.length, 1);
  assert.deepEqual(Object.keys(status[0]).sort(), ['attempts','created_at_ms','status']);
  assert.equal(status[0].status, 'pending');
  assert.equal(status[0].attempts, 0);
  assert.equal(typeof status[0].created_at_ms, 'bigint');

  // A wrong queue mapping is a denial, not a fallback to another queue.
  c.setPrincipal(governor);
  ok(await c.set_notification_queue_canister(principal(8)));
  c.setPrincipal(test2);
  denied(await c.read_account_my_dev_test2_event_delivery(eventId));
  c.setPrincipal(governor);
  ok(await c.set_notification_queue_canister(queueCanisterId));

  // Revoke role after the notification exists; status becomes unavailable.
  ok(await c.remove_role_grant(test2, clubId, 'parent', [teamId]));
  c.setPrincipal(test2);
  denied(await c.read_account_my_dev_test2_event_delivery(eventId));
  c.setPrincipal(governor);
  ok(await c.add_role_grant(test2, clubId, 'parent', [teamId]));

  // Recovered membership is sufficient, but the queue must not be fenced.
  q.setPrincipal(governor);
  ok(await q.set_transfer_fence(clubId, true));
  c.setPrincipal(test2);
  denied(await c.read_account_my_dev_test2_event_delivery(eventId));
  q.setPrincipal(governor);
  ok(await q.set_transfer_fence(clubId, false));

  // Other noncanonical invite rows cannot change the result of the precise
  // official-event-key lookup. Duplicate canonical IDs are separately
  // prohibited by fan_out's existing idempotency handling.
  q.setPrincipal(governor);
  assert.equal(ok(await q.fan_out([test2.toText()], clubId, 'event_invite',
    'Different unrelated invite', 'pocketic-event-notice-2', [eventId])), 1);
  c.setPrincipal(test2);
  assert.equal(option(await c.read_account_my_dev_test2_event_delivery(eventId))[0].status, 'pending');

  // The test never registers devices, marks delivery, or calls a live endpoint.
  console.log('PASS: disposable G2 IDs, signed Test2 Parent success/null, caller/event/queue/role/fence denials, canonical receipt-key matching, bounded response. Zero real pushes and zero deployment.');
} finally {
  await pic?.tearDown();
  await server.stop();
}
