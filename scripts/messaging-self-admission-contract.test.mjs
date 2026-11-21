import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chat = readFileSync(new URL('../backend/messaging_domain/src/main.mo', import.meta.url), 'utf8');
const club = readFileSync(new URL('../backend/club_domain/src/main.mo', import.meta.url), 'utf8');
const did = readFileSync(new URL('../backend/club_domain/club_domain.did', import.meta.url), 'utf8');
const section = (source, first, last) => {
  const a = source.indexOf(first);
  const b = source.indexOf(last, a + first.length);
  assert.ok(a >= 0 && b > a, 'missing section '+first);
  return source.slice(a,b);
};
const body = section(chat, 'func read_account_recent_conversations(', 'public shared ({ caller }) func read_account_list_all_online_users(');
const proof = section(chat, 'func readRecentChatScopeProofs(', 'func recentChatScopeAllowed(');
const allowed = section(chat, 'func recentChatScopeAllowed(', 'public shared ({ caller }) func read_account_recent_conversations(');
const service = section(club, 'func read_chat_scope_access_batch(', '// Shared-key private-detail audiences');

test('inbox still admits self only once, gates cross-principal reads and fences removal', () => {
  const admitted = body.indexOf('await admitAccount(caller)');
  const elevation = body.indexOf('if (not caller.equal(principal) and not isGovernor(caller) and not hasRole(caller, "app_admin", null, null))');
  const entered = body.indexOf('if (not removalReceiver.enter(principal))');
  const conditional = body.indexOf('if (not caller.equal(principal)) { await admitAccount(principal) };');
  const firstProof = body.indexOf('await* readRecentChatScopeProofs(principal, clubs, teams)');
  assert.ok(0 <= admitted && admitted < elevation && elevation < entered && entered < conditional && conditional < firstProof);
  assert.match(body, /if \(removalReceiver\.denied\(caller\)\) throw Error\.reject\("Account removal fenced"\)/);
  assert.match(body, /if \(removalReceiver\.denied\(principal\)\) throw Error\.reject\("Account removal fenced"\)/);
  const afterFirst = body.slice(admitted + 'await admitAccount(caller);'.length, conditional);
  assert.doesNotMatch(afterFirst.replaceAll(/\/\/[^\n]*/g, ''), /\bawait\b/);
});

test('inbox batches exact participant scopes twice, rechecks and retains full result coverage', () => {
  const marks = [
    'c.participants.any(func(p) = p.equal(principal))',
    'not isGroupDeleted(c.id)',
    'var clubs : [Text] = []',
    'var teams : [(Text, Text)] = []',
    'if (requiresClubMembership(c))',
    'let ?initial = await* readRecentChatScopeProofs(principal, clubs, teams)',
    'let current = conversations.find(func(item) = item.id == c.id)',
    'recentChatScopeAllowed(principal, c, initial)',
    'let ?freshProofs = await* readRecentChatScopeProofs(principal, clubs, teams)',
    'let fresh = conversations.find(func(item) = item.id == candidate.id)',
    'recentChatScopeAllowed(principal, candidate, freshProofs)',
    'current.participants.any(func(p) = p.equal(principal))',
    'not isGroupDeleted(candidate.id)',
    'current.club_id == candidate.club_id',
    'current.team_id == candidate.team_id',
    'requiresClubMembership(current) == requiresClubMembership(candidate)',
    'let sorted = authorized.sort'
  ];
  let pos = 0;
  for (const mark of marks) {
    const next = body.indexOf(mark, pos);
    assert.ok(next >= pos, 'missing or out of order: ' + mark);
    pos = next + mark.length;
  }
  assert.match(body, /Chat authorization temporarily unavailable/);
  assert.match(body, /Chat authorization changed; retry/);
  assert.doesNotMatch(body, /entries\.size\(\)\s*>=\s*Nat16\.toNat\(limit\)/);
  assert.match(body, /#Ok\(Array\.tabulate<Types\.RecentConversation>\(take/);
});

test('every scope proof is bounded, exact, caller-specific and never cached', () => {
  assert.match(proof, /clubDomainCanister/);
  assert.match(proof, /read_chat_scope_access_batch\(user, clubChunk, teamChunk\)/);
  assert.match(proof, /Nat\.min\(64, clubIds\.size\(\) - clubOffset\)/);
  assert.match(proof, /Nat\.min\(64, teamIds\.size\(\) - teamOffset\)/);
  assert.match(proof, /proofs\.clubs\.size\(\) != clubCount or proofs\.teams\.size\(\) != teamCount/);
  assert.match(proof, /proofs\.clubs\[i\]\.0 != clubChunk\[i\]/);
  assert.match(proof, /proofs\.teams\[i\]\.0 != teamChunk\[i\]\.0 or proofs\.teams\[i\]\.1 != teamChunk\[i\]\.1/);
  assert.match(proof, /configured != clubDomainCanister or removalReceiver\.denied\(user\)/);
  assert.match(allowed, /if \(not requiresClubMembership\(c\)\) return true/);
  assert.match(allowed, /isGovernor\(user\) or/);
  assert.match(allowed, /not clubAllowed or isFenced\(c\.club_id\)/);
  assert.match(allowed, /club == c\.club_id and id == team and allowed/);
  assert.doesNotMatch(proof, /stable\s+(var|let)/);
  assert.doesNotMatch(body, /mark_?read|set_?unread|last_read_sequence\s*:=|unread\.put\(|send_message\(/i);
});

test('club batch restricts arbitrary principals to pinned messaging service, admits once and enforces exact team ownership', () => {
  assert.match(service, /let \?messaging = messagingDomainCanister else return #Err/);
  assert.match(service, /if \(caller != messaging\) return #Err/);
  assert.match(service, /if \(user == Principal\.anonymous\(\)\) return #Err/);
  assert.match(service, /club_ids\.size\(\) > 64 or team_scopes\.size\(\) > 64/);
  assert.equal((service.match(/await admitAccount\(user\)/g)||[]).length, 1, 'one admission per bounded batch');
  assert.match(service, /not removalReceiver\.enter\(user\)/);
  assert.match(service, /messagingDomainCanister != \?caller or removalReceiver\.denied\(user\)/);
  assert.match(service, /not isExcluded\(user, club\) and isMember\(user, club\)/);
  assert.match(service, /liveTeamClub\(team\) == \?club/);
  assert.match(service, /not isExcluded\(user, club\)/);
  assert.match(service, /isOnTeam\(user, team\) or isAdmin\(user, club\)/);
  assert.match(service, /finally \{ removalReceiver\.leave\(user\) \}/);
  assert.match(service, /finally \{ privateNameWriterGate\.leave\(privateWriterLease\) \}/);
  assert.match(did, /read_chat_scope_access_batch: \(user: principal/);
  assert.doesNotMatch(service, /message\.body|private_name|vetkey|username|email|pii_access_control/i);
});
