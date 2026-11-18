import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chat = readFileSync(new URL('../backend/messaging_domain/src/main.mo', import.meta.url), 'utf8');
const start = chat.indexOf('func read_account_recent_conversations(');
const end = chat.indexOf('public shared ({ caller }) func read_account_list_all_online_users(', start);
assert.ok(start >= 0 && end > start);
const body = chat.slice(start, end);

test('self conversation listing admits once, preserves elevated access denial and removal fencing', () => {
  const admitted = body.indexOf('await admitAccount(caller)');
  const elevation = body.indexOf('if (not caller.equal(principal) and not isGovernor(caller) and not hasRole(caller, "app_admin", null, null))');
  const entered = body.indexOf('if (not removalReceiver.enter(principal))');
  const conditional = body.indexOf('if (not caller.equal(principal)) { await admitAccount(principal) };');
  const accessed = body.indexOf('await* requireChatClubMember(principal, club)');
  assert.ok(0 <= admitted && admitted < elevation && elevation < entered && entered < conditional && conditional < accessed);
  assert.match(body, /if \(removalReceiver\.denied\(caller\)\) throw Error\.reject\("Account removal fenced"\)/);
  assert.match(body, /if \(removalReceiver\.denied\(principal\)\) throw Error\.reject\("Account removal fenced"\)/);
  const afterFirstAdmission = body.slice(admitted + 'await admitAccount(caller);'.length, conditional);
  assert.doesNotMatch(afterFirstAdmission.replaceAll(/\/\/[^\n]*/g, ''), /\bawait\b/, 'do not suspend before self fast-path admission');
});

test('request-local positive club/team scope proofs and final live revocation checks remain enforced', () => {
  const ordered = [
    'c.participants.any(func(p) = p.equal(principal))',
    'not isGroupDeleted(c.id)',
    'var approvedClubs : [Text] = []',
    'var approvedTeams : [(Text, Text)] = []',
    'await* requireChatClubMember(principal, club)',
    'await* requireChatTeamMember(principal, club, team)',
    'let fresh = conversations.find(func(c) = c.id == conversation.id)',
    'var freshClubs : [Text] = []',
    'var freshTeams : [(Text, Text)] = []',
    'await* requireChatClubMember(principal, club)',
    'await* requireChatTeamMember(principal, club, team)',
    'let fresh = conversations.find(func(c) = c.id == candidate.id)',
    'current.participants.any(func(p) = p.equal(principal))',
    'not isGroupDeleted(candidate.id)',
    'let sorted = authorized.sort'
  ];
  let pos = 0;
  for (const token of ordered) {
    const found = body.indexOf(token, pos);
    assert.ok(found >= pos, 'missing/out of order: ' + token);
    pos = found + token.length;
  }
  assert.match(body, /approvedClubs\.any\(func\(id\) = id == club\)/);
  assert.match(body, /approvedTeams\.any\(func\(\(scope, id\)\) = scope == club and id == team\)/);
  assert.match(body, /freshClubs\.any\(func\(id\) = id == candidate\.club_id\)/);
  assert.match(body, /freshTeams\.any\(func\(\(club, id\)\) = club == candidate\.club_id and id == team\)/);
  assert.match(body, /current\.club_id == candidate\.club_id/);
  assert.match(body, /current\.team_id == candidate\.team_id/);
  assert.match(body, /requiresClubMembership\(current\) == requiresClubMembership\(candidate\)/);
  assert.match(body, /await\* requireChatAccess\(principal, conversation\.id\)/, 'exempt/DM scope still uses existing path');
  assert.match(body, /if \(removalReceiver\.denied\(principal\)\)/, 'post-await removal recheck');
  assert.doesNotMatch(body, /if \(entries\.size\(\) >= Nat16\.toNat\(limit\)\) break/, 'never underfill result by early stopping before revalidation');
});

test('inbox optimisation cannot modify Virtuoso, messages, unread state or stored permissions', () => {
  assert.match(body, /func read_account_recent_conversations/);
  assert.match(body, /#Ok\(Array\.tabulate<Types\.RecentConversation>\(take/);
  assert.doesNotMatch(body, /mark_?read|set_?unread|last_read_sequence\s*:=|unread\.put\(|send_message\(|update_group\(/i);
  assert.doesNotMatch(body, /stable\s+(var|let)/, 'proof sets must be request-local only');
});
