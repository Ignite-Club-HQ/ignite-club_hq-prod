wit_bindgen::generate!({world:"sync-plugin",path:"sync-plugin.wit"});
use candid::{Encode,Decode,Principal,CandidType};
use serde::Deserialize;
use icp::sync_plugin::types::CallType;
#[derive(CandidType,Deserialize)] enum SetupReply { Ok, Err(String) }
struct Plugin;
const OWNER:&str="4sf7q-x5j7l-a3cwp-dt7rd-evzpu-gextt-cmqum-fmzsg-avqpp-wk7ga-sae";
fn invoke(target:&str,method:&str,arg:Vec<u8>,kind:CallType)->Result<Vec<u8>,String>{canister_call(&CanisterCallRequest{target:CallTarget::Name(target.into()),method:method.into(),arg,call_type:kind,direct:true,cycles:0})}
impl Guest for Plugin {
 fn exec(input:SyncExecInput)->Result<(),String>{
  if input.identity_principal!=OWNER{return Err("OpenCloud owner identity does not match this DEV bundle".into())}
  let data=input.files.iter().find(|f|f.key=="links").ok_or("Missing exact service wiring plan")?;
  let ids:std::collections::BTreeMap<_,_>=input.canister_ids.iter().map(|e|(e.name.as_str(),e.id.as_str())).collect();
  let mut used=std::collections::BTreeSet::new();
  for name in input.fields.iter().find(|f|f.name=="inventory").ok_or("Missing inventory")?.value.split(','){
   let p=Principal::from_text(*ids.get(name).ok_or(format!("Missing service {name}"))?).map_err(|_|"Invalid installed principal")?;
   if p==Principal::anonymous()||p==Principal::management_canister()||!used.insert(p){return Err("Invalid/duplicate new inventory".into())}
  }
  for line in data.content.lines().filter(|s|!s.trim().is_empty()){
   let parts:Vec<_>=line.split('|').collect();if parts.len()!=4{return Err("Invalid wiring record".into())}
   let(target,method,shape,args)=(parts[0],parts[1],parts[2],parts[3]);
   let ps:Result<Vec<_>,_>=args.split(',').filter(|s|!s.is_empty()).map(|name|Principal::from_text(*ids.get(name).ok_or("Missing linked service")?).map_err(|_|"Invalid linked principal")).collect();let ps=ps?;
   let arg=match shape{"none"=>Encode!(),"one"=>Encode!(&ps[0]),"vec"=>Encode!(&ps),"two"=>Encode!(&ps[0],&ps[1]),_=>return Err("Unsupported wiring shape".into())}.map_err(|_|"Cannot encode setup arguments")?;
   let bytes=invoke(target,method,arg,CallType::Update)?;
   match Decode!(&bytes,SetupReply).map_err(|_|format!("Invalid response from {target}.{method}"))?{SetupReply::Ok=>(),SetupReply::Err(_)=>return Err(format!("Setup refused at {target}.{method}; retain installation for inspection"))}
   eprintln!("Confirmed {target}.{method}");
  }
  // Read back all domain configuration after all reciprocal writes settle.
  for name in input.fields.iter().find(|f|f.name=="readers").ok_or("Missing readers")?.value.split(','){
   let bytes=invoke(name,"read_group_opening_configuration",Encode!().map_err(|_|"Encode read")?,CallType::Update)?;
   let rows=Decode!(&bytes,Vec<(String,String)>).map_err(|_|format!("Unreadable configuration {name}"))?;
   if rows.is_empty(){return Err(format!("Empty configuration {name}"))}
   for (field,value) in &rows { if let Some(expected)=ids.get(field.as_str()) { if !value.is_empty() && value!=expected { return Err(format!("Configuration mismatch {name}.{field}")) } } }
   
   eprintln!("Read back {name} ({} settings); no admission granted",rows.len());
  }
  let bytes=invoke("pii_access_control","pii_vetkey_verification_key",Encode!().map_err(|_|"Encode key")?,CallType::Update)?;
  let key=Decode!(&bytes,Vec<u8>).map_err(|_|"Invalid proxy public key response")?;
  if key.len()!=96{return Err("Proxy encryption verification key invalid".into())}
  eprintln!("Fresh DEV services configured; proxy public key confirmed. No existing clubs moved, no push sender or admission enabled.");Ok(())
 }
}
export!(Plugin);
