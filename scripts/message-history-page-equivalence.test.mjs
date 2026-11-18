// Synthetic, read-only pagination equivalence. No canisters or member data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chat = readFileSync(new URL('../backend/messaging_domain/src/main.mo', import.meta.url), 'utf8');
const start = chat.indexOf('func read_account_list_latest_messages_page(');
const end = chat.indexOf('public shared ({ caller }) func read_account_search_messages(',start);
assert.ok(start>=0 && end>start);
const body=chat.slice(start,end);

// Historical algorithm: two scans, drop oldest excess (reference only).
function oldPage(messages,conversation,before,limit) {
  const matching=messages.filter(m=>m.conversation_id===conversation && m.sequence < before);
  const skip=Math.max(0,matching.length-limit);
  const chosen=matching.slice(skip);
  return {messages:chosen,next_sequence:skip>0 ? chosen[0].sequence:null};
}
// New algorithm: last N+1 matching, then reverse into send order.
function newPage(messages,conversation,before,limit) {
  const newest=[];
  for(let i=messages.length-1;i>=0 && newest.length<=limit;i--) {
    const m=messages[i]; if(m.conversation_id===conversation && m.sequence<before)newest.push(m);
  }
  const hasOlder=newest.length>limit;
  const rows=newest.slice(0,hasOlder?limit:newest.length).reverse();
  return {messages:rows,next_sequence:hasOlder?rows[0].sequence:null};
}
test('protected history retains signed admission, current team authority and removal fences',()=>{
  assert.match(body,/await admitAccount\(caller\)/);
  assert.match(body,/await\* requireChatAccess\(caller, conversation_id\)/);
  assert.match(body,/not canReadTeamMessages\(caller, conversation_id\)/);
  assert.match(body,/if \(limit == 0 or limit > 100\)/);
  assert.match(body,/if \(cursor > latest\) return #Err\("Stale cursor"\)/);
});
test('reverse scan bounds stored page to limit plus one and preserves cursor',()=>{
  assert.match(body,/while \(index > 0 and newest\.size\(\) <= limit_n\)/);
  assert.match(body,/newest := newest\.concat\(\[m\]\)/);
  assert.match(body,/Array\.tabulate<Types\.Message>\(page_size/);
  assert.doesNotMatch(body,/for \(m in messages\.values\(\)\)/);
  assert.match(body,/if \(has_older and page_size > 0\) \?page_messages\[0\]\.sequence/);
});
test('equivalent pages and cursors for interleaved histories, sizes and cursors',()=>{
  for(const size of [0,1,2,5,20,101,300,500]) {
    const msgs=[];let ca=0,cb=0;
    for(let i=0;i<size;i++){
      const isA=i%3!==0;
      msgs.push({conversation_id:isA?'A':'B',sequence:isA?++ca:++cb,id:'id-'+i});
    }
    for(const conversation of ['A','B','missing'])
      for(const limit of [1,2,5,20,100])
        for(const before of [1,2,5,20,50,250,1000]) {
          assert.deepEqual(newPage(msgs,conversation,before,limit),
            oldPage(msgs,conversation,before,limit),
            'size '+size+' conversation '+conversation+' before '+before+' limit '+limit);
        }
  }
});
test('cursor never repeats a message on consecutive pages',()=>{
  const messages=Array.from({length:42},(_,i)=>({conversation_id:'A',id:'m-'+i,sequence:i+1}));
  let cursor=43,ids=[];
  for(let n=0;n<20;n++){
    const page=newPage(messages,'A',cursor,5);
    ids.push(...page.messages.map(x=>x.id));
    if(page.next_sequence==null)break;
    cursor=page.next_sequence;
  }
  assert.equal(new Set(ids).size,ids.length);
  assert.deepEqual(ids,Array.from({length:42},(_,i)=> 'm-'+i).reverse().reduce((rows,id,i)=>{
    if(i%5===0)rows.push([]);rows.at(-1).unshift(id);return rows;
  },[]).flat());
});
