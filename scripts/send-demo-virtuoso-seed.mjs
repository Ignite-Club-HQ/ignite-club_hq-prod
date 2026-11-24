#!/usr/bin/env node
/**
 * Authenticated, allowlisted, resumable PROD test-data sender.
 * Run from frontend/ after npm ci, using an explicitly supplied Ed25519
 * Internet Identity JSON export in a local protected file. Never log keys.
 *
 * node ../scripts/send-demo-virtuoso-seed.mjs /path/to/manifest.json
 *
 * PRECONDITIONS: The key must derive the SAME principal as the authorized
 * PROD Ignite account; normal Internet Identity delegations generally cannot
 * be recreated from an unrelated raw Ed25519 key. If identity differs,
 * membership/authorization checks fail closed. No identity is created here.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const {Actor,HttpAgent}=require('@dfinity/agent');
const {IDL}=require('@dfinity/candid');
const {Ed25519KeyIdentity}=require('@dfinity/identity');
const CLUB='9c5fa204-6cbe-49d5-a3d2-26b98b0419de';
const CANISTER='ttcqg-raaaa-aaaai-ayeoq-cai';
const ALLOW=new Set([
 `default-club-chat:${CLUB}:coaches`,
 `default-club-chat:${CLUB}:club_committee`,
 `default-club-chat:${CLUB}:team_admins`,
 `chat-${CLUB}-13`,CLUB,
 'b13954cf-a9f8-4b51-9cb1-0f7ec6a31820',
 'd4f22f68-26a0-4868-a0aa-2b28dcd01933',
 'e813df04-63bd-4dcb-bdf9-bccfa8c57d21',
 'f04f188b-8cb4-475e-9f31-0cf0f83ab20c'
]);
const Message=IDL.Record({id:IDL.Text,conversation_id:IDL.Text,body:IDL.Text,reply_to_id:IDL.Opt(IDL.Text),sender:IDL.Principal,created_at_ms:IDL.Nat64,edited_at_ms:IDL.Opt(IDL.Nat64),attachment:IDL.Opt(IDL.Record({url:IDL.Opt(IDL.Text),kind:IDL.Text,ref_id:IDL.Text})),sequence:IDL.Nat64,idempotency_key:IDL.Text});
const Page=IDL.Record({messages:IDL.Vec(Message),latest_sequence:IDL.Nat64,next_sequence:IDL.Opt(IDL.Nat64)});
const Result=t=>IDL.Variant({Ok:t,Err:IDL.Text});
const idlFactory=({IDL})=>IDL.Service({
 read_account_read_conversation_club:IDL.Func([IDL.Text],[Result(IDL.Opt(IDL.Text))],[]),
 read_account_list_messages_page:IDL.Func([IDL.Text,IDL.Opt(IDL.Nat64),IDL.Nat16],[Result(Page)],[]),
 send_message:IDL.Func([IDL.Text,IDL.Text,IDL.Text,IDL.Opt(IDL.Record({url:IDL.Opt(IDL.Text),kind:IDL.Text,ref_id:IDL.Text})),IDL.Opt(IDL.Text)],[Result(Message)],[])
});
function ok(result,context){if(!('Ok' in result))throw Error(`${context}: ${result.Err}`);return result.Ok}
async function main(){
 const file=process.argv[2],identityFile=process.env.IGNITE_DEMO_SEED_IDENTITY_FILE;
 if(!file||!identityFile)throw Error('Manifest argument and IGNITE_DEMO_SEED_IDENTITY_FILE required');
 const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
 if(manifest.club_id!==CLUB||manifest.canister_id!==CANISTER||manifest.threads?.length!==9)throw Error('Manifest club, canister or thread count mismatch');
 if(new Set(manifest.threads.map(t=>t.conversation_id)).size!==9||manifest.threads.some(t=>t.club_id!==CLUB||!ALLOW.has(t.conversation_id)))throw Error('Manifest contains unapproved conversation');
 if(manifest.threads.some(t=>t.messages?.length!==manifest.target_per_thread||t.messages.some(m=>!m.body.startsWith('[DEMO TEST DATA]')||!/^virtuoso-seed-v1-\d+-\d+$/.test(m.idempotency_key))))throw Error('Invalid sample messages');
 const identity=Ed25519KeyIdentity.fromJSON(fs.readFileSync(identityFile,'utf8'));
 const agent=await HttpAgent.create({host:'https://icp-api.io',identity});
 const actor=Actor.createActor(idlFactory,{agent,canisterId:CANISTER});
 const expected=process.env.IGNITE_DEMO_SEED_EXPECTED_PRINCIPAL;
 if(!expected||identity.getPrincipal().toText()!==expected)throw Error('Authenticated principal does not match explicit expected principal');
 const check=async id=>{
   const club=ok(await actor.read_account_read_conversation_club(id),'club ownership');
   if(club.length!==1||club[0]!==CLUB)throw Error(`Refusing out-of-club or inaccessible thread ${id}`);
 };
 // Verify ALL conversations before the first write.
 for(const t of manifest.threads)await check(t.conversation_id);
 if(process.env.IGNITE_DEMO_SEED_CONFIRM!==`SEED ${CLUB}`)throw Error('Explicit confirmation required; no writes made');
 let written=0;
 for(const t of manifest.threads){
   // Recheck ownership before every message. No retries on ambiguous send failures.
   for(const m of t.messages){
     await check(t.conversation_id);
     const sent=ok(await actor.send_message(t.conversation_id,m.body,m.idempotency_key,[],[]),'send');
     if(sent.conversation_id!==t.conversation_id)throw Error('Unexpected response conversation ID');
     written++;
     if(written%25===0)console.log(`Sent ${written} scoped messages`);
     await new Promise(resolve=>setTimeout(resolve,150));
   }
   const page=ok(await actor.read_account_list_messages_page(t.conversation_id,[],1),'readback');
   console.log(`${t.name}: latest sequence ${page.latest_sequence.toString()}`);
 }
 console.log(`Completed ${written} message sends, scoped to ${CLUB}`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
