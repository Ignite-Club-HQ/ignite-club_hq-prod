wit_bindgen::generate!({world:"sync-plugin",path:"../sync-plugin.wit"});
use candid::{Encode, Decode, CandidType, Principal};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use icp::sync_plugin::types::CallType;

#[derive(CandidType, Deserialize)]
enum Start { Started { session_id: u64 }, Busy { owner: Principal, idle_for_secs: u64 } }
#[derive(CandidType)]
struct Chunks { session_id: u64, chunks: Vec<Vec<u8>> }
#[derive(CandidType)]
struct Create { key: String, content_type: String, headers: Vec<(String,String)> }
#[derive(CandidType)]
enum Encoding { Identity }
#[derive(CandidType)]
struct Content { key: String, encoding: Encoding, chunk_ids: Vec<u64>, sha256: Vec<u8>, chunk_sha256: Vec<Vec<u8>> }
#[derive(CandidType)]
enum Operation { CreateAsset(Create), SetAssetContent(Content) }
#[derive(CandidType)]
struct Execute { session_id: u64, operations: Vec<Operation>, is_final: bool }
struct Plugin;
fn call(method: &str, arg: Vec<u8>) -> Result<Vec<u8>,String> {
    canister_call(&CanisterCallRequest { target: CallTarget::Host, method:method.into(), arg, call_type:CallType::Update, direct:true, cycles:0 })
}
fn encode_error(_: candid::Error) -> String { "Frontend setup encoding failed".into() }
impl Guest for Plugin {
 fn exec(input: SyncExecInput) -> Result<(),String> {
    if input.identity_principal != "4sf7q-x5j7l-a3cwp-dt7rd-evzpu-gextt-cmqum-fmzsg-avqpp-wk7ga-sae" { return Err("DEV frontend owner mismatch".into()) }
    let p=Principal::from_text(&input.canister_id).map_err(|_|"Invalid frontend ID")?;
    if p==Principal::anonymous() || p==Principal::management_canister() {return Err("Invalid frontend ID".into())}
    let id=p.to_text();
    let hosts=["icp0.io","raw.icp0.io","icp.net","raw.icp.net","ic0.app","raw.ic0.app"];
    let origins:Vec<_>=hosts.iter().filter(|h|**h!="icp0.io").map(|h|format!("https://{id}.{h}")).collect();
    let callbacks:Vec<_>=hosts.iter().flat_map(|h|["/auth","/native-sign-in.html","/native-sign-in"].map(|path|format!("https://{id}.{h}{path}"))).collect();
    let manifest=input.files.iter().find(|f|f.key=="architecture").ok_or("Missing engine architecture")?;
    let mut architecture:serde_json::Value=serde_json::from_str(&manifest.content).map_err(|_|"Invalid architecture JSON")?;
    let rows=architecture["canisters"].as_array_mut().ok_or("Invalid architecture inventory")?;
    let row=rows.iter_mut().find(|r|r["name"]=="frontend").ok_or("Missing frontend inventory")?;
    row["id"]=serde_json::Value::String(id.clone());
    let old_ids:std::collections::BTreeMap<String,String>=serde_json::from_str(&input.files.iter().find(|f|f.key=="backend_ids").ok_or("Missing backend mapping")?.content).map_err(|_|"Invalid backend mapping")?;
    if old_ids.len()!=18 {return Err("Expected eighteen backend services".into())}
    let mut script=input.files.iter().find(|f|f.key=="entry_script").ok_or("Missing frontend script")?.content.clone();
    let mut seen=std::collections::BTreeSet::new();
    seen.insert(p);
    for (name,old) in old_ids {
      let entry=input.canister_ids.iter().find(|e|e.name==name).ok_or("Missing new backend ID")?;
      let principal=Principal::from_text(&entry.id).map_err(|_|"Invalid backend ID")?;
      if principal==Principal::anonymous() || principal==Principal::management_canister() || !seen.insert(principal) {return Err("Invalid or duplicate backend ID".into())}
      if !script.contains(&old) {return Err("Frontend script missing expected backend ID".into())}
      script=script.replace(&old,&entry.id);
      for row in rows.iter_mut() { if row["id"]==old {row["id"]=serde_json::Value::String(entry.id.clone());} }
    }
    let script_key=&input.fields.iter().find(|f|f.name=="script_key").ok_or("Missing frontend script path")?.value;
    if !script_key.starts_with("/assets/") || !script_key.ends_with(".js") {return Err("Invalid frontend script path".into())}
    let mut assets=vec![
      ("/.well-known/ii-alternative-origins","application/json",serde_json::json!({"alternativeOrigins":origins}).to_string()),
      ("/.well-known/ii-auth-callbacks","application/json",serde_json::json!({"callbacks":callbacks}).to_string()),
      ("/.well-known/ii-derivation-origin","text/plain",format!("https://{id}.icp0.io\n")),
      ("/.well-known/ic-architecture","application/json",architecture.to_string())
    ];
    assets.push((script_key.as_str(),"text/javascript",script));
    let reply=call("start_sync",Encode!().map_err(encode_error)?)?;
    let session_id=match Decode!(&reply,Start).map_err(encode_error)? { Start::Started{session_id}=>session_id, Start::Busy{..}=>return Err("Frontend sync busy; do not repeat an unknown upload".into()) };
    let chunks:Vec<_>=assets.iter().map(|(_,_,s)|s.as_bytes().to_vec()).collect();
    let reply=call("upload_chunks",Encode!(&Chunks{session_id,chunks:chunks.clone()}).map_err(encode_error)?)?;
    let chunk_ids=Decode!(&reply,Vec<u64>).map_err(encode_error)?;
    if chunk_ids.len()!=assets.len(){return Err("Incomplete frontend metadata upload".into())}
    let mut operations=Vec::new();
    for (i,(key,content_type,_)) in assets.iter().enumerate(){
      operations.push(Operation::CreateAsset(Create{key:(*key).into(),content_type:(*content_type).into(),headers:vec![("Cache-Control".into(),"no-cache".into()),("X-Content-Type-Options".into(),"nosniff".into())]}));
      let hash=Sha256::digest(&chunks[i]).to_vec();
      operations.push(Operation::SetAssetContent(Content{key:(*key).into(),encoding:Encoding::Identity,chunk_ids:vec![chunk_ids[i]],sha256:hash.clone(),chunk_sha256:vec![hash]}));
    }
    let reply=call("execute_operations",Encode!(&Execute{session_id,operations,is_final:true}).map_err(encode_error)?)?;
    let hash=Decode!(&reply,Option<Vec<u8>>).map_err(encode_error)?.ok_or("Frontend metadata did not finalize")?;
    if hash.len()!=32 {return Err("Invalid frontend state hash".into())}
    Ok(())
 }
}
export!(Plugin);

#[cfg(test)]
mod tests {
 use super::*;
 fn input(owner: &str, id: &str) -> SyncExecInput {
   SyncExecInput { canister_id:id.into(), environment:"ic".into(), api_url:"https://icp-api.io/".into(), gateway_url:None, proxy_canister_id:None,
    dirs:vec![], files:vec![], fields:vec![], canister_ids:vec![], identity_principal:owner.into() }
 }
 #[test]
 fn refuses_non_owner_before_calls() {
   assert_eq!(Plugin::exec(input("2vxsx-fae","vhyif-7yaaa-aaac5-aaasq-cai")),Err("DEV frontend owner mismatch".into()));
 }
 #[test]
 fn refuses_reserved_frontend_before_calls() {
   let owner="4sf7q-x5j7l-a3cwp-dt7rd-evzpu-gextt-cmqum-fmzsg-avqpp-wk7ga-sae";
   assert_eq!(Plugin::exec(input(owner,"aaaaa-aa")),Err("Invalid frontend ID".into()));
 }
}