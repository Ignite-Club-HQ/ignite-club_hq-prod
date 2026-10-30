import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const ts=require('typescript');
const source=readFileSync(new URL('./release-templates/email-signup-policy.ts',import.meta.url),'utf8');
const compile=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const BRIDGE='966bdaec-ebf1-46da-b2b3-cc53bf05c422',BASKET='493ee2e3-c834-487d-93be-d1c8a0dbc4a8';
function policy(config, token=null, row=null, error=null){
 const exports={}; const calls=[];
 const supabase={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{value:config},error})})})}),
   rpc:async(name)=>{calls.push(name);return {data:name==='get_pending_invite_by_token'&&row?[row]:[],error:null};}};
 vm.runInNewContext(compile,{exports,require:name=>name.includes('client')?{supabase}:{readAuthIntent:()=>({invite:token,next:null}),safeSessionGet:()=>null},window:{location:{search:''}},URLSearchParams,Date,Set,Number});
 return {exports,calls};
}
test('retained club invitations work, outside clubs and uninvited signup fail',async()=>{
 for(const id of [BRIDGE,BASKET]){
  const p=policy({emailAuthClubs:[{id:BRIDGE},{id:BASKET}]},'token',{club_id:id,status:'pending',invited_email:'member@example.test'});
  assert.equal(await p.exports.prepareEmailSignup('member@example.test'),'token');
 }
 const missing=policy({emailAuthClubs:[{id:BRIDGE}]});
 await assert.rejects(missing.exports.prepareEmailSignup('member@example.test'),/invitation/);
 assert.equal(missing.calls.length,0);
 const other=policy({emailAuthClubs:[{id:BRIDGE}]},'token',{club_id:BASKET,status:'pending',invited_email:'member@example.test'});
 await assert.rejects(other.exports.prepareEmailSignup('member@example.test'),/invitation/);
});
test('malformed armed settings and unreadable settings never become open signup',async()=>{
 for(const setting of [{emailAuthClubs:'invalid'},{emailAuthClubs:[{id:'invalid'}]},{emailAuthClubs:[{id:BRIDGE},{id:BRIDGE}]}]){
  await assert.rejects(policy(setting).exports.prepareEmailSignup('member@example.test'),/verify/);
 }
 await assert.rejects(policy(null,null,null,new Error('offline')).exports.prepareEmailSignup('member@example.test'),/verify/);
 assert.equal(await policy({emailAuthClubs:[]}).exports.prepareEmailSignup('member@example.test'),null);
});
test('retained-email edits preserve unrelated routing fields and before-images',()=>{
 const p=policy(null); const before={defaultBackend:'supabase',targets:[{id:'original'}],savedAtMs:100,emailAuthClubs:[]};
 const changed=p.exports.updateEmailClubsBeforeImage(before,[{id:BRIDGE,name:'retained'}]);
 assert.equal(changed.targets,before.targets);assert.equal(changed.savedAtMs,100);assert.equal(before.emailAuthClubs.length,0);
 assert.equal(changed.emailAuthClubs[0].id,BRIDGE);
});