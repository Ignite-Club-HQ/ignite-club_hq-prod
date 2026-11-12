/**
 * Per-member DEV ICP actor adapter for the Ignite-owned MCP server.
 *
 * Every backend method starts from the authenticated caller's actorFactory.
 * No principals, routing targets or service identities are accepted from
 * MCP tool parameters. Placement resolver MUST be server-authoritative.
 *
 * Intentionally requires two injected trusted infrastructure functions:
 *  - listDevGroups(session): signed-in user's declared, allowlisted group IDs
 *  - resolveClubPlacement(session,clubId): canonical signed placement proof
 *
 * It cannot work without a verified Internet Identity delegation, because
 * the returned actors must be signed by the same authenticated member.
 */
import {DEV_ORIGIN} from "./core.mjs";
const idPattern=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
function deny(message){const e=new Error(message);e.code="ICP_ACCESS_DENIED";throw e;}
function ensureId(v,label){if(typeof v!=="string"||!idPattern.test(v))deny("Invalid "+label);return v;}
function checkSession(session){
  if(!session?.oauthVerified||!session.internetIdentityDelegationVerified||
     session.environment!=="dev"||session.derivationOrigin!==DEV_ORIGIN||
     !idPattern.test(session.principal||"")||
     typeof session.actorFactory!=="function")deny("Verified member delegation required");
}
function unvariant(result,label){
  if(result&&typeof result==="object"&&!Array.isArray(result)){
    if("Ok" in result)return result.Ok;
    if("Err" in result)deny(label+" access denied");
    if("ok" in result)return result.ok;
    if("err" in result)deny(label+" access denied");
  }
  deny("Invalid "+label+" response");
}
function countBytes(value){return new TextEncoder().encode(value).length;}
async function verifiedGroup(session,group,services){
  if(!group||group.environment!=="dev"||group.declared!==true ||
     !services.every(name=>typeof group.canisters?.[name]==="string"&&
       idPattern.test(group.canisters[name])))deny("Unverified DEV service group");
  const actorEntries=await Promise.all(services.map(async name=>{
    // The identity bridge's actorFactory MUST attest the actual signed caller,
    // and verify each canister belongs to this declared group.
    const actor=await session.actorFactory(group.canisters[name],name);
    if(!actor||typeof actor!=="object")deny("Caller-owned ICP actor unavailable");
    return [name,actor];
  }));
  return Object.fromEntries(actorEntries);
}
function parseRows(data){
  if(!data||typeof data!=="object"||!Array.isArray(data.rows))deny("Invalid caller-scoped data");
  return data.rows.map(row=>{
    const cells=Array.isArray(row)?row:row?.cells;
    if(!Array.isArray(cells))deny("Malformed caller-scoped row");
    const record={};
    for(const cell of cells){
      if(typeof cell?.name!=="string"||typeof cell.value!=="object")deny("Malformed data cell");
      const val=cell.value;
      record[cell.name]=("text" in val?val.text:"bool" in val?val.bool:"int" in val?Number(val.int):null);
    }
    return record;
  });
}
function paginationEnd(data){
  if(!data||!Array.isArray(data.clubs))deny("Invalid club membership response");
  if(data.next!=null)deny("Club membership index requires pagination; refusing partial result");
  return data.clubs.map(x=>ensureId(x,"club"));
}
export function createCallerIcpBackend({listDevGroups,resolveClubPlacement}={}){
  if(typeof listDevGroups!=="function"||typeof resolveClubPlacement!=="function")
    throw Error("Signed DEV group discovery and secure placement resolver required");
  async function groupForClub(session,club){
    checkSession(session);ensureId(club,"club");
    const group=await resolveClubPlacement(session,club);
    if(group?.club_id!==club)deny("Placement ownership mismatch");
    return group;
  }
  async function clubActor(session,club){
    const group=await groupForClub(session,club);
    return (await verifiedGroup(session,group,["club"])).club;
  }
  async function signedMembership(session,club){
    const actor=await clubActor(session,club);
    if(typeof actor.read_my_club_memberships_indexed!=="function")deny("Protected club membership unavailable");
    const data=unvariant(await actor.read_my_club_memberships_indexed([],50),"club memberships");
    return paginationEnd(data).includes(club);
  }
  async function signedTeams(session,club){
    const actor=await clubActor(session,club);
    if(typeof actor.read_account_execute!=="function")deny("Protected team list unavailable");
    const query=JSON.stringify({entity:"teams",select:["id","club_id","name"],limit:100});
    return parseRows(await actor.read_account_execute(query))
      .filter(t=>t.club_id===club).map(t=>({
        id:ensureId(t.id,"team"),club_id:club,name:String(t.name||"")
      }));
  }
  async function scopedMessaging(session,club,team,conversation){
    if(!(await signedMembership(session,club)))deny("Club membership not authorized");
    if(!(await signedTeams(session,club)).some(t=>t.id===team))deny("Team not accessible");
    const group=await groupForClub(session,club);
    const actor=(await verifiedGroup(session,group,["messaging"])).messaging;
    if(typeof actor.read_account_list_groups_by_team!=="function")deny("Protected chat discovery unavailable");
    const rooms=unvariant(await actor.read_account_list_groups_by_team(team),"team conversations");
    if(!Array.isArray(rooms))deny("Malformed team conversations");
    const room=rooms.find(r=>r.conversation_id===conversation &&
      r.club_id?.[0]===club && r.team_id?.[0]===team &&
      r.kind==="team" && r.is_member===true);
    if(!room)deny("Not a member of the requested team chat");
    return {actor,room};
  }
  return Object.freeze({
    async getProfile(session){
      checkSession(session);
      // Do not infer an Ignite app user from a JWT email or user ID.
      return {id:session.principal};
    },
    async listMyClubs(session){
      checkSession(session);
      const groups=await listDevGroups(session);
      if(!Array.isArray(groups)||groups.length>10)deny("Invalid DEV group directory");
      const result=[];
      for(const group of groups){
        const {club}=await verifiedGroup(session,group,["club"]);
        const members=paginationEnd(unvariant(await club.read_my_club_memberships_indexed([],50),"club memberships"));
        if(members.length){
          const rows=parseRows(await club.read_account_execute(JSON.stringify({
            entity:"clubs",select:["id","name"],limit:100
          })));
          for(const row of rows)if(members.includes(row.id))result.push({id:ensureId(row.id,"club"),name:String(row.name||"")});
        }
      }
      return [...new Map(result.map(x=>[x.id,x])).values()];
    },
    hasClubAccess:signedMembership,
    async hasTeamAccess(session,club,team){
      return (await signedMembership(session,club)) &&
        (await signedTeams(session,club)).some(x=>x.id===team);
    },
    listMyTeams:signedTeams,
    async listEvents(session,club,team){
      if(!(await signedMembership(session,club)))deny("Club membership not authorized");
      if(team&&!(await signedTeams(session,club)).some(t=>t.id===team))deny("Team not accessible");
      const group=await groupForClub(session,club);
      const {events}=await verifiedGroup(session,group,["events"]);
      if(typeof events.read_account_list_events!=="function")deny("Protected event read unavailable");
      const data=await events.read_account_list_events([club],team?[team]:[]);
      if(!Array.isArray(data))deny("Invalid event response");
      return data.filter(e=>e.club_id===club&&(!team||e.team_id?.[0]===team));
    },
    async listConversations(session,club,team){
      if(!team)deny("Explicit team required for private chat discovery");
      if(!(await signedMembership(session,club)))deny("Club membership not authorized");
      if(!(await signedTeams(session,club)).some(t=>t.id===team))deny("Team not accessible");
      const group=await groupForClub(session,club);
      const {messaging}=await verifiedGroup(session,group,["messaging"]);
      const rooms=unvariant(await messaging.read_account_list_groups_by_team(team),"team chat listing");
      if(!Array.isArray(rooms))deny("Invalid chat listing");
      return rooms.filter(r=>r.kind==="team"&&r.is_member===true&&
        r.club_id?.[0]===club&&r.team_id?.[0]===team);
    },
    async hasConversationAccess(session,club,team,conversation){
      try{await scopedMessaging(session,club,team,conversation);return true;}
      catch(e){if(e?.code==="ICP_ACCESS_DENIED")return false;throw e;}
    },
    async listConversationMessages(session,club,team,conversation,before,limit){
      const {actor}=await scopedMessaging(session,club,team,conversation);
      if(typeof actor.read_account_list_latest_messages_page!=="function")deny("Protected history unavailable");
      const cursor=before===null?[]:[BigInt(before)];
      const page=unvariant(await actor.read_account_list_latest_messages_page(conversation,cursor,limit),"message history");
      if(!Array.isArray(page.messages))deny("Invalid chat history");
      if(page.messages.some(m=>m.conversation_id!==conversation))deny("Cross-conversation message");
      return {
        messages:page.messages.map(m=>({...m,sender:typeof m.sender==="string"?m.sender:m.sender.toText(),
          edited_at_ms:m.edited_at_ms?.[0]??null,reply_to_id:m.reply_to_id?.[0]??null,
          attachment:m.attachment?.[0]??null})),
        latest_sequence:page.latest_sequence,
        next_sequence:page.next_sequence?.[0]??null
      };
    },
    async canPostToConversation(session,club,team,conversation){
      const {actor}=await scopedMessaging(session,club,team,conversation);
      if(typeof actor.read_account_get_group_metadata!=="function")return false;
      const metadata=unvariant(await actor.read_account_get_group_metadata(conversation),"posting policy");
      // For now, do NOT grant posting to an admin-only room even if the
      // member might be an admin: require a separate verified role method.
      return metadata?.conversation_id===conversation &&
        metadata.deleted!==true && metadata.admin_only_posting===false;
    },
    async sendConversationMessage(session,club,team,conversation,body,key){
      const {actor}=await scopedMessaging(session,club,team,conversation);
      if(!(await this.canPostToConversation(session,club,team,conversation)))deny("Posting is restricted");
      if(countBytes(body)>4000)deny("Message too large");
      if(typeof actor.send_message!=="function")deny("Protected send method unavailable");
      // Exactly one caller-signed write. No retry, provisioning, or re-routing.
      const sent=unvariant(await actor.send_message(conversation,body,key,[],[]),"send message");
      return {...sent,sender:typeof sent.sender==="string"?sent.sender:sent.sender.toText()};
    }
  });
}
