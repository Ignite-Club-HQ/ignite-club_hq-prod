import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const chat=readFileSync(new URL('../backend/messaging_domain/src/main.mo',import.meta.url),'utf8');
const start=chat.indexOf('func read_account_recent_conversations(');
const end=chat.indexOf('public shared ({ caller }) func read_account_list_all_online_users(',start);
assert.ok(start>=0 && end>start);
const body=chat.slice(start,end);

test('self conversation listing admits the caller once without changing cross-principal gates',()=>{
 const admitted=body.indexOf('await admitAccount(caller)');
 const elevation=body.indexOf('if (not caller.equal(principal) and not isGovernor(caller) and not hasRole(caller, "app_admin", null, null))');
 const entered=body.indexOf('if (not removalReceiver.enter(principal))');
 const conditional=body.indexOf('if (not caller.equal(principal)) { await admitAccount(principal) };');
 const accessed=body.indexOf('await* requireChatAccess(principal, conversation.id)');
 assert.ok(0<=admitted && admitted<elevation && elevation<entered && entered<conditional && conditional<accessed);
 assert.match(body,/if \(removalReceiver\.denied\(caller\)\) throw Error\.reject\("Account removal fenced"\)/);
 assert.match(body,/if \(removalReceiver\.denied\(principal\)\) throw Error\.reject\("Account removal fenced"\)/);
 assert.match(body,/conversation\.participants\.any\(func\(p\) = p\.equal\(principal\)\)/);
 assert.match(body,/not isGroupDeleted\(conversation\.id\)/);
});
test('self-account fast path does not bypass any current live club/team permission check',()=>{
 assert.match(body,/let visible = try \{ await\* requireChatAccess\(principal, conversation\.id\); true \} catch \(_\) \{ false \}/);
 assert.match(body,/if \(visible and not isGroupDeleted\(conversation\.id\)\)/);
 const afterFirstAdmission=body.slice(body.indexOf('await admitAccount(caller);')+'await admitAccount(caller);'.length,body.indexOf('if (not caller.equal(principal)) { await admitAccount(principal) };'));
 assert.doesNotMatch(afterFirstAdmission.replaceAll(/\/\/[^\n]*/g,''),/\bawait\b/, 'no external call between caller admission and self fast-path');
});
