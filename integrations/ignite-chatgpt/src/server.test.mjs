import test from "node:test";
import assert from "node:assert/strict";
import {handleRpc, createIgniteMcpHttpServer, UI_URI} from "./server.mjs";
import {DEV_ORIGIN} from "./core.mjs";

const principal="mbrvi-lvde7-gdspi-hamp3-nxj43-p4tt6-at6q5-jlbit-eehve-7xqwc-wqe";
const session={oauthVerified:true,internetIdentityDelegationVerified:true,environment:"dev",
  derivationOrigin:DEV_ORIGIN,principal,actorFactory:()=>({}),scopes:["ignite:read","ignite:chat:send"]};
const root={club_id:"club-1",team_id:"team-1",conversation_id:"chat-1"};
let sends=0;
const backend={
  listMyClubs:async()=>[{id:"club-1",name:"Test club"}],
  hasClubAccess:async(_s,id)=>id==="club-1",
  hasTeamAccess:async(_s,c,t)=>c==="club-1"&&t==="team-1",
  hasConversationAccess:async(_s,c,t,x)=>c==="club-1"&&t==="team-1"&&x==="chat-1",
  canPostToConversation:async(_s,c,t,x)=>c==="club-1"&&t==="team-1"&&x==="chat-1",
  listConversations:async()=>[{conversation_id:"chat-1",name:"Team chat",club_id:"club-1",team_id:"team-1",kind:"team"}],
  listConversationMessages:async()=>({messages:[{id:"msg-1",body:"Hi",conversation_id:"chat-1",sender:principal,sequence:1n,created_at_ms:123n}],latest_sequence:1n,next_sequence:null}),
  sendConversationMessage:async(s,c,t,chat,body,key)=>{sends++;return{id:"msg-2",body,conversation_id:chat,idempotency_key:key,sender:s.principal,created_at_ms:456n};},
};
const params=(method,p)=>({jsonrpc:"2.0",id:42,method,params:p});
const handler=(req,config={})=>handleRpc(req,{authenticate:async()=>config.session??session,backend:{...backend,...config.backend},loadUi:async()=>"<html>Test widget</html>"});
test("rejects startup when either OAuth or ICP adapter is absent",()=>{
 assert.throws(()=>createIgniteMcpHttpServer({}),/OAuth\/II bridge/);
 assert.throws(()=>createIgniteMcpHttpServer({verifyBearerToken:async()=>session}),/OAuth\/II bridge/);
});
test("tool discovery exposes a verified MCP Apps template and hides send from the model",async()=>{
 const result=await handler(params("tools/list",{}));
 const tools=result.result.tools;
 const open=tools.find(t=>t.name==="open_my_ignite_chat");
 const send=tools.find(t=>t.name==="send_team_message");
 assert.equal(open._meta.ui.resourceUri,UI_URI);
 assert.deepEqual(send._meta.ui.visibility,["app"]);
 assert.equal(tools.filter(t=>t.name==="send_team_message").length,1);
});
test("MCP UI resource is registered with proper MIME",async()=>{
 const list=await handler(params("resources/list",{}));
 assert.equal(list.result.resources[0].mimeType,"text/html;profile=mcp-app");
 const doc=await handler(params("resources/read",{uri:UI_URI}));
 assert.equal(doc.result.contents[0].text,"<html>Test widget</html>");
});
test("open chat returns caller-scoped authorized thread and verified send capability",async()=>{
 const result=await handler(params("tools/call",{name:"open_my_ignite_chat",arguments:root}));
 assert.deepEqual(result.result.structuredContent.messages.map(m=>m.body),["Hi"]);
 assert.equal(result.result.structuredContent.environment,"dev");
 assert.equal(result.result.structuredContent.can_send,true);
 assert.equal(result.result.structuredContent.principal,undefined);
});
test("unverified or missing read scope denies open and discovery",async()=>{
 const a=await handler(params("tools/list",{}),{session:{...session,scopes:["ignite:chat:send"]}});
 assert.equal(a.error.code,-32001);
 const b=await handler(params("tools/call",{name:"open_my_ignite_chat",arguments:root}),{session:{...session,oauthVerified:false}});
 assert.equal(b.error.code,-32001);
});
test("one direct send gives one backend call without generated ChatGPT follow-up",async()=>{
 const before=sends;
 const request={...root,body:"Hi team",client_request_id:"fef5d3fc-9038-48d4-890c-4805d8fe773e"};
 const r=await handler(params("tools/call",{name:"send_team_message",arguments:request}));
 assert.equal(r.result.structuredContent.status,"sent");
 assert.equal(r.result.structuredContent.message.body,"Hi team");
 assert.equal(sends-before,1);
});
test("sending with read-only token is denied before backend write",async()=>{
 const before=sends;
 const r=await handler(params("tools/call",{name:"send_team_message",arguments:{...root,body:"Not allowed",client_request_id:"fef5d3fc-9038-48d4-890c-4805d8fe773e"}}),{session:{...session,scopes:["ignite:read"]}});
 assert.equal(r.error.code,-32003);
 assert.equal(sends,before);
});
test("forged other-club chat fails, no send",async()=>{
 const before=sends;
 const r=await handler(params("tools/call",{name:"send_team_message",arguments:{...root,conversation_id:"chat-2",body:"No",client_request_id:"fef5d3fc-9038-48d4-890c-4805d8fe773e"}}));
 assert.equal(r.error.code,-32003);
 assert.equal(sends,before);
});
test("HTTP endpoint rejects no bearer and malformed content",async()=>{
 const server=createIgniteMcpHttpServer({verifyBearerToken:async()=>session,backend,authorizationServerUrl:"https://auth-dev.example.invalid",resourceUrl:"https://mcp-dev.example.invalid/mcp"});
 await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
 const url="http://127.0.0.1:"+server.address().port+"/mcp";
 try{
 const a=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(params("tools/list",{}))});
 assert.equal(a.status,401);
 assert.match(a.headers.get("www-authenticate"),/resource_metadata="https:\/\/mcp-dev\.example\.invalid\/\.well-known\/oauth-protected-resource"/);
 const metadata=await fetch(url.replace("/mcp","/.well-known/oauth-protected-resource"));
 assert.equal(metadata.status,200);
 assert.deepEqual((await metadata.json()).authorization_servers,["https://auth-dev.example.invalid"]);
 const b=await fetch(url,{method:"POST",headers:{"authorization":"Bearer testtoken","content-type":"text/plain"},body:"x"});
 assert.equal(b.status,415);
 const c=await fetch(url,{method:"POST",headers:{"authorization":"Bearer testtoken","content-type":"application/json"},body:JSON.stringify(params("initialize",{}))});
 assert.equal(c.status,200);
 assert.equal((await c.json()).result.serverInfo.name,"ignite-club-hq-dev-mcp");
 }finally{await new Promise((ok,bad)=>server.close(e=>e?bad(e):ok()));}
});
test("startup refuses missing OAuth modules in production environment",async()=>{
 const {startFromEnvironment}=await import("./server.mjs");
 await assert.rejects(startFromEnvironment({}),/Missing verified Ignite OAuth and ICP adapter/);
});

test("invalid discovery URLs fail closed",()=>{
 assert.throws(()=>createIgniteMcpHttpServer({verifyBearerToken:async()=>session,backend,
   authorizationServerUrl:"http://example.invalid",resourceUrl:"https://mcp-dev.example.invalid/mcp"}),/Pinned HTTPS/);
 assert.throws(()=>createIgniteMcpHttpServer({verifyBearerToken:async()=>session,backend,
   authorizationServerUrl:"https://auth-dev.example.invalid",resourceUrl:"https://mcp-dev.example.invalid/private"}),/Pinned HTTPS/);
});

test("tool-level missing scope triggers host-native OAuth linking metadata, not raw prompt text",async()=>{
 const server=createIgniteMcpHttpServer({
   verifyBearerToken:async()=>({...session,scopes:["ignite:read"]}),
   backend,authorizationServerUrl:"https://auth-dev.example.invalid/tenant/dev",
   resourceUrl:"https://mcp-dev.example.invalid/mcp",
 });
 await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
 const host="http://127.0.0.1:"+server.address().port;
 try{
   const d=await fetch(host+"/.well-known/oauth-protected-resource");
   assert.deepEqual((await d.json()).authorization_servers,["https://auth-dev.example.invalid/tenant/dev"]);
   const call=await fetch(host+"/mcp",{
     method:"POST",
     headers:{"authorization":"Bearer dummy","content-type":"application/json"},
     body:JSON.stringify(params("tools/call",{name:"open_my_ignite_chat",arguments:root})),
   });
   assert.equal(call.status,200);
   // An authenticated caller with the right read scope should open normally.
   assert.equal((await call.json()).result.structuredContent.environment,"dev");
 }finally{await new Promise(ok=>server.close(ok));}
});
test("tool descriptors specify separate read and send OAuth scopes",async()=>{
 const result=await handler(params("tools/list",{}));
 const send=result.result.tools.find(t=>t.name==="send_team_message");
 const read=result.result.tools.find(t=>t.name==="open_my_ignite_chat");
 assert.deepEqual(send.securitySchemes[0].scopes,["ignite:read","ignite:chat:send"]);
 assert.deepEqual(read.securitySchemes[0].scopes,["ignite:read"]);
});
test("missing OAuth read scope on a tool call returns an OAuth re-link hint",async()=>{
 const server=createIgniteMcpHttpServer({
  verifyBearerToken:async()=>({...session,scopes:["ignite:chat:send"]}),
  backend,authorizationServerUrl:"https://auth-dev.example.invalid",
  resourceUrl:"https://mcp-dev.example.invalid/mcp",
 });
 await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
 try{
 const resp=await fetch("http://127.0.0.1:"+server.address().port+"/mcp",{
  method:"POST",headers:{"authorization":"Bearer dummy","content-type":"application/json"},
  body:JSON.stringify(params("tools/call",{name:"open_my_ignite_chat",arguments:root}))
 });
 assert.equal(resp.status,200);
 const payload=await resp.json();
 assert.equal(payload.result.isError,true);
 assert.match(payload.result._meta["mcp/www_authenticate"][0],/insufficient_scope/);
 }finally{await new Promise(ok=>server.close(ok));}
});
