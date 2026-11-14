// Source-contract safety checks for the TEMPORARY Test2-only DEV readback.
// These are not PocketIC integration tests and do not assert real push delivery.
// Run: node --test scripts/dev-test2-notification-readback.test.mjs
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const queue = read('backend/notification_queue/src/main.mo');
const club = read('backend/club_domain/src/main.mo');
const queueDid = read('backend/notification_queue/notification_queue.did');
const clubDid = read('backend/club_domain/club_domain.did');
const manifestPolicy = read('scripts/group2-mcp-discovery.mjs');
const eventId = 'evt-70eccd5e-28cd-54b5-9bbd-d0dc74eea9ca-1';
const clubId = '70eccd5e-28cd-54b5-9bbd-d0dc74eea9ca';
const teamId = 'ef943494-1c7f-58e3-a28d-db39e545319f';
const test2 = 'pfslb-rpozk-543m5-zll3a-a3ay4-rdg3b-elojg-ukmfs-e624l-6rjyp-jae';
const q2 = 'zu4gk-vqaaa-aaaal-qxp5a-cai';
const c2 = 'yfwyv-nyaaa-aaaal-qxpyq-cai';

function method(src, name, nextName) {
  const start = src.indexOf('func ' + name + '(');
  assert.ok(start >= 0, 'missing method ' + name);
  const end = src.indexOf('func ' + nextName + '(', start);
  assert.ok(end > start, 'missing delimiter for ' + name);
  return src.slice(start, end);
}

const qRead = method(queue, 'read_trusted_dev_test2_event_delivery', 'get_notification');
const cRead = method(club, 'read_account_my_dev_test2_event_delivery', 'read_account_get_club_roster');

test('only exact G2 services and Test2 event/recipient are eligible', () => {
  for (const id of [clubId, eventId, test2, q2]) {
    assert.ok(qRead.includes(id), 'queue not pinned: ' + id);
  }
  for (const id of [clubId, teamId, eventId, test2, q2, c2]) {
    assert.ok(cRead.includes(id), 'club not pinned: ' + id);
  }
  assert.match(qRead, /clubDomainCanister != \?caller/);
  assert.match(qRead, /Principal\.toText\(Principal\.fromActor\(this\)\) != devQueue/);
  assert.match(cRead, /caller\.toText\(\) != devUser/);
  assert.match(cRead, /Principal\.toText\(Principal\.fromActor\(this\)\) != devClubCanister/);
  assert.match(cRead, /not isMember\(caller, devClub\)/);
  assert.match(cRead, /grant\.team == \?devTeam and grant\.role == "parent"/);
  assert.match(cRead, /not eligible\(\) or notificationQueueCanister != \?configured/);
});

test('queue readback cannot enumerate inboxes, users, bodies, tokens, or receipts', () => {
  assert.match(qRead, /n\.user == devUser and n\.club == devClub and n\.kind == "event_invite" and n\.related_id == \?devEvent/);
  assert.match(qRead, /matches\.size\(\) > 1/);
  assert.match(qRead, /matches\.size\(\) == 0/);
  assert.match(qRead, /#Ok\(\?\{ status; attempts = item\.attempts; created_at_ms = item\.created_at_ms \}\)/);
  assert.doesNotMatch(qRead, /(?:items\s*:=|device_tokens\s*:=|wakeNativeSender|\.fan_out\(|\.enqueue\(|\.body\b|\.token\b)/);
  assert.doesNotMatch(cRead, /(?:acl\s*:=|rsvps\s*:=|\.fan_out\(|\.enqueue\(|device_tokens)/);
  for (const did of [clubDid, queueDid]) {
    assert.match(did, /Ok: opt record\s*\{\s*attempts: nat32;\s*created_at_ms: nat64;\s*status: text;/);
  }
});

test('no new trust configuration or broad MCP queue discovery', () => {
  assert.match(manifestPolicy, /Not exposed on Group 2 by this DEV integration:/);
  assert.match(manifestPolicy, /pii_access_control, notification_queue, timer_jobs/);
  const customerEntries = manifestPolicy.slice(
    manifestPolicy.indexOf('export const GROUP2_CUSTOMER_SERVICES'),
    manifestPolicy.indexOf(']);', manifestPolicy.indexOf('export const GROUP2_CUSTOMER_SERVICES')),
  );
  assert.doesNotMatch(customerEntries, /notification_queue/);
  assert.match(cRead, /notificationQueueCanister \?\? return #Err/);
  assert.match(cRead, /configured\.toText\(\) != devQueue/);
  assert.match(qRead, /case \(#Delivered\) "delivered"/);
  assert.match(qRead, /case \(#Failed\) "failed"/);
});
