/**
 * Ignite DEV MCP HTTP transport - deliberately fail closed.
 *
 * Dependency-free protocol harness for DEV review. Does NOT implement OAuth,
 * Internet Identity login, token exchange or an ICP actor: inject those
 * verified components from a separately deployed, audited auth bridge.
 * The server refuses startup without BOTH adapter modules.
 */
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {dirname, resolve} from "node:path";
import {createIgniteHandlers, invokeIgniteTool, invokeIgniteAppTool,
  TOOL_NAMES, APP_ONLY_TOOL_NAMES, PluginAccessError, DEV_ORIGIN} from "./core.mjs";

export const UI_URI = "ui://ignite/my-team-chat-v1.html";
const UI_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../ui/my-ignite-live.html");
const SERVER_VERSION = "0.1.0-dev";
const schema = (properties={},required=[])=>({type:"object",properties,required,additionalProperties:false});
const id = {type:"string",minLength:1,maxLength:128};
const common={club_id:id,team_id:id,conversation_id:id};
const toolDefinitions=[
  {name:"open_my_ignite_chat",description:"Open the authenticated Ignite DEV team chat with real messages and a direct-send composer.",inputSchema:schema(common,["club_id","team_id","conversation_id"]),_meta:{ui:{resourceUri:UI_URI},"openai/outputTemplate":UI_URI}},
  {name:"list_my_clubs",description:"List the signed-in member's Ignite DEV clubs.",inputSchema:schema()},
  {name:"list_my_teams",description:"List the signed-in member's accessible teams in one club.",inputSchema:schema({club_id:id},["club_id"])},
  {name:"list_conversations",description:"List accessible chats for a club and team.",inputSchema:schema({club_id:id,team_id:id},["club_id","team_id"])},
  {name:"list_conversation_messages",description:"Read a page of authorized chat messages.",inputSchema:schema({...common,before_sequence:{type:"string",pattern:"^[0-9]+$"},limit:{type:"integer",minimum:1,maximum:50}},["club_id","team_id","conversation_id"])},
  {name:"list_team_events",description:"List caller-authorized Ignite DEV events.",inputSchema:schema({club_id:id,team_id:id},["club_id","team_id"])},
  {name:"send_team_message",description:"App-only direct Send. The customer must tap Send in the verified chat widget.",inputSchema:schema({...common,body:{type:"string",minLength:1,maxLength:2000},client_request_id:{type:"string",format:"uuid"}},["club_id","team_id","conversation_id","body","client_request_id"]),_meta:{ui:{visibility:["app"]}}},
];
if(!APP_ONLY_TOOL_NAMES.includes("send_team_message"))throw Error("App-only send capability missing");
const onlyPublic=new Set([...TOOL_NAMES,"open_my_ignite_chat"]);
function fail(code,message){const e=new Error(message);e.mcpCode=code;throw e;}
function rpcError(id,code,message){return {jsonrpc:"2.0",id,error:{code,message}};}
function rpcOk(id,result){return {jsonrpc:"2.0",id,result};}
function asObj(value){if(!value||typeof value!=="object"||Array.isArray(value))fail(-32602,"Invalid tool arguments");return value;}
function requireReadScope(session){
  if(!Array.isArray(session?.scopes)||!session.scopes.includes("ignite:read"))fail(-32001,"An Ignite read scope is required");
}
async function handleToolsCall(params,session,backend){
  const name=params?.name;
  if(typeof name!=="string" || !toolDefinitions.some(t=>t.name===name))fail(-32601,"Unknown Ignite tool");
  const args=asObj(params.arguments??{});
  const handlers=createIgniteHandlers({resolveVerifiedSession:async()=>session,backend});
  if(name==="open_my_ignite_chat"){
    requireReadScope(session);
    const {club_id,team_id,conversation_id}=args;
    // Never accept client-provided claims of membership / posting rights.
    // Both reads re-check the exact signed-in caller's authorized scope.
    const chats=await invokeIgniteTool(handlers,"list_conversations",{club_id,team_id},{});
    if(!chats.conversations.some(x=>x.id===conversation_id))fail(-32003,"Chat is not accessible to this account");
    const page=await invokeIgniteTool(handlers,"list_conversation_messages",{club_id,team_id,conversation_id,limit:20},{});
    const posting=typeof backend.canPostToConversation==="function" &&
      session.scopes?.includes("ignite:chat:send") &&
      await backend.canPostToConversation(session,club_id,team_id,conversation_id)===true;
    // No principal, OAuth token, canister ID or actor metadata is exposed.
    const structuredContent={club_id,team_id,conversation_id,
      environment:"dev",can_send:!!posting,...page};
    return {structuredContent,content:[{type:"text",text:
      "Ignite DEV team chat opened with "+page.messages.length+" recent messages."}],
      _meta:{ui:{resourceUri:UI_URI}}};
  }
  if(name==="send_team_message"){
    // This route is ONLY available as an app tool on a verified OAuth transport.
    // Neither the UI nor the supplied params can forge session capabilities.
    const data=await invokeIgniteAppTool(handlers,name,args,{});
    return {structuredContent:data,content:[{type:"text",text:"Message "+(data.status==="sent"?"sent":"not confirmed")}]};
  }
  requireReadScope(session);
  const data=await invokeIgniteTool(handlers,name,args,{});
  return {structuredContent:data,content:[{type:"text",text:"Ignite DEV "+name+" completed."}]};
}
export async function handleRpc(request,{authenticate,backend,loadUi=()=>readFile(UI_PATH,"utf8")}={}){
  if(!request||request.jsonrpc!=="2.0"||typeof request.method!=="string")
    return rpcError(request?.id??null,-32600,"Invalid JSON-RPC request");
  if(request.id===undefined)return null; // MCP initialized notification
  const id=request.id;
  try{
    // Even capability discovery is protected by a valid OAuth session.
    if(typeof authenticate!=="function"||!backend)fail(-32001,"Ignite authentication not configured");
    const session=await authenticate();
    if(!session?.oauthVerified||!session?.internetIdentityDelegationVerified ||
       session.environment!=="dev"||session.derivationOrigin!==DEV_ORIGIN ||
       typeof session.principal!=="string"||typeof session.actorFactory!=="function")
       fail(-32001,"Ignite DEV sign-in required");
    switch(request.method){
      case "initialize":
        return rpcOk(id,{protocolVersion:"2025-06-18",capabilities:{tools:{listChanged:false},resources:{listChanged:false}},
          serverInfo:{name:"ignite-club-hq-dev-mcp",version:SERVER_VERSION}});
      case "ping":return rpcOk(id,{});
      case "tools/list":
        requireReadScope(session);
        return rpcOk(id,{tools:toolDefinitions});
      case "tools/call":
        return rpcOk(id,await handleToolsCall(request.params,session,backend));
      case "resources/list":
        requireReadScope(session);
        return rpcOk(id,{resources:[{uri:UI_URI,name:"My Ignite team chat",mimeType:"text/html;profile=mcp-app"}]});
      case "resources/read":{
        requireReadScope(session);
        if(request.params?.uri!==UI_URI)fail(-32602,"Unknown UI resource");
        const html=await loadUi();
        return rpcOk(id,{contents:[{uri:UI_URI,mimeType:"text/html;profile=mcp-app",text:html}]});
      }
      default:fail(-32601,"Unknown MCP method");
    }
  }catch(e){
    const code=e.mcpCode??(e instanceof PluginAccessError?-32003:-32603);
    return rpcError(id,code,e instanceof PluginAccessError?e.message:
      e.mcpCode?e.message:"Ignite tool unavailable");
  }
}
export function createIgniteMcpHttpServer({verifyBearerToken,backend,loadUi}={}){
  if(typeof verifyBearerToken!=="function"||!backend)
    throw new Error("Verified OAuth/II bridge and ICP backend adapter are required; refusing to start");
  return createServer(async(req,res)=>{
    const write=(status,body,headers={})=>{
      res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff",...headers});
      res.end(JSON.stringify(body));
    };
    if(req.url!=="/mcp"||req.method!=="POST"){write(404,{error:"Not found"});return;}
    const auth=/^Bearer ([A-Za-z0-9\-._~+/]+=*)$/.exec(req.headers.authorization??"");
    if(!auth){write(401,{error:"Authorization required"},{"www-authenticate":'Bearer error="invalid_token"'});return;}
    if(!String(req.headers["content-type"]??"").toLowerCase().startsWith("application/json")){
      write(415,{error:"Content-Type must be application/json"});return;
    }
    let body="";
    try{
      for await(const chunk of req){
        body+=chunk;
        if(body.length>65536){write(413,{error:"Request too large"});return;}
      }
      const input=JSON.parse(body);
      if(!input||Array.isArray(input)||typeof input!=="object"){write(400,{error:"Invalid request"});return;}
      const result=await handleRpc(input,{authenticate:()=>verifyBearerToken(auth[1],{method:input.method}),backend,loadUi});
      if(result===null){res.writeHead(202,{"cache-control":"no-store"});res.end();return;}
      write(result.error?.code===-32001?401:200,result);
    }catch(e){write(400,{error:"Invalid request"});}
  });
}
/** No credential inference. This requires independently implemented, tested
 * modules which enforce issuer/audience/signature/expiry/scopes and REAL
 * caller-owned Internet Identity actors. Never enable a demo fallback. */
export async function startFromEnvironment(env=process.env){
  if(!env.IGNITE_OAUTH_ADAPTER_MODULE||!env.IGNITE_ICP_ADAPTER_MODULE)
    throw Error("Missing verified Ignite OAuth and ICP adapter modules. Startup blocked.");
  const oauth=await import(env.IGNITE_OAUTH_ADAPTER_MODULE);
  const icp=await import(env.IGNITE_ICP_ADAPTER_MODULE);
  const server=createIgniteMcpHttpServer({verifyBearerToken:oauth.verifyBearerToken,backend:icp.backend});
  return new Promise((resolveStart,reject)=>{
    server.once("error",reject);
    server.listen(Number(env.PORT||8000),"127.0.0.1",()=>resolveStart(server));
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  startFromEnvironment().catch(e=>{console.error(e.message);process.exitCode=1;});
}
