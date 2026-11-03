//! Separate, signed account-read capability. A review draft cannot grant it.
//! The independent signer attests exact inventory provenance and externally
//! fenced recovery/runtime evidence. No signer is supplied by the caller.
use candid::{CandidType, Principal};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use crate::production_account_protection::{Draft, Expectation};

pub const KIND: &str = "ignite-production-account-readers-v1";
pub const FULL_KIND: &str = "ignite-production-account-protection-v1";
pub const INVENTORY_KIND: &str = "ignite-production-account-inventory-v1";
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApprovalBody {
    pub kind: String,
    pub identity: Principal,
    pub operator: Principal,
    pub generation: u64,
    pub expires_at_ns: u64,
    pub expectation: Expectation,
    pub review: Draft,
    pub original_inventory_evidence: Vec<u8>,
    pub runtime_evidence: Vec<u8>,
    pub fenced_recovery_evidence: Vec<u8>,
    pub recovery_epoch: u64,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct SignedApproval { pub body: ApprovalBody, pub signature: Vec<u8> }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct State { pub generation: u64, pub approval: Option<SignedApproval> }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct WitnessRequest {
    pub identity: Principal, pub generation: u64, pub recovery_epoch: u64,
    pub signed_digest: Vec<u8>, pub request_id: u64,
    pub history_revision: u64, pub removal_generation: u64, pub identity_version: u64,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct WitnessReceipt { pub request: WitnessRequest }
impl Default for State { fn default() -> Self { Self { generation:0, approval:None } } }

pub fn signing_bytes(body: &ApprovalBody) -> Result<Vec<u8>, String> {
    bounds(body)?;
    let bytes=candid::encode_one(body).map_err(|_|"Invalid production approval encoding")?;
    if bytes.len()>1_048_576 { return Err("Production approval exceeds bounded budget".into()); }
    let mut payload=b"ignite:production-account-authorization:v1\0".to_vec();
    payload.extend(Sha256::digest(bytes)); Ok(payload)
}
// Fixed production scope: two groups, 26 domains, <=64 stores per group.
// Check every attacker-sized string/vector/blob before cloning or Candid work.
fn bounds(b:&ApprovalBody)->Result<(),String> {
    let text=|s:&str,limit:usize|s.len()<=limit;
    let inventory=|i:&crate::group_inventory::RemovalInventory| {
        let binding=&i.groups.binding;
        i.groups.snapshot.groups.len()==2 && i.groups.snapshot.placements.len()==2 &&
        i.supplemental.len()<=129 && i.media.len()==2 &&
        text(&binding.target_alias,64) && text(&binding.deployment_id,64) && text(&binding.host,512) && text(&binding.network_kind,32) &&
        i.groups.snapshot.groups.iter().all(|g|text(&g.id,64) && text(&g.target_alias,64) && g.domains.len()==13 && g.domains.iter().all(|d|text(&d.domain,64))) &&
        i.groups.snapshot.placements.iter().all(|p|text(&p.group_id,64) && text(&p.deployment_id,64) && text(&p.host,512) && text(&p.network_kind,32) &&
            p.approved_subnets.len()<=64 && p.domains.len()==13 && p.domains.iter().all(|d|text(&d.domain,64))) &&
        i.supplemental.iter().all(|s|text(&s.group_id,64) && text(&s.domain,64)) &&
        i.media.iter().all(|m|m.registry.stores.len()<=64)
    };
    if !text(&b.kind,64) || !inventory(&b.expectation.inventory) || !inventory(&b.review.inventory) ||
        b.expectation.modules.len()>155 || b.expectation.modules.iter().any(|(_,h)|h.len()!=32) ||
        b.review.lifecycle.len()>155 || b.review.lifecycle.iter().any(|l|l.module_hash.len()!=32) ||
        b.review.configurations.len()>154 || b.review.targets.len()>154 ||
        b.review.account_readers.len()>150 || b.review.eligibility_readers.len()>150 ||
        [&b.original_inventory_evidence,&b.runtime_evidence,&b.fenced_recovery_evidence].iter().any(|v|v.len()!=32) {
        return Err("Production approval exceeds exact bounded scope".into());
    } Ok(())
}
pub fn key() -> Result<VerifyingKey,String> {
    parse_key(option_env!("IGNITE_PRODUCTION_ACCOUNT_APPROVER_PUBLIC_KEY").ok_or("Independent production account signer not configured")?)
}
/// Immutable witness program fingerprint and sole controller. Address alone
/// would accept a swapped program installed by whoever controls the witness.
pub fn witness_binding() -> Result<(Vec<u8>,Principal),String> {
    let hash=option_env!("IGNITE_PRODUCTION_ACCOUNT_WITNESS_MODULE_HASH").ok_or("Recovery witness program pin not configured")?;
    let ctl=option_env!("IGNITE_PRODUCTION_ACCOUNT_WITNESS_CONTROLLER").ok_or("Recovery witness controller pin not configured")?;
    parse_binding(hash,ctl)
}
pub fn parse_binding(hash:&str,ctl:&str)->Result<(Vec<u8>,Principal),String>{
    let h=hex::decode(hash).map_err(|_|"Invalid recovery witness program pin")?;
    if h.len()!=32 || h.iter().all(|b|*b==0) {return Err("Invalid recovery witness program pin".into());}
    let c=Principal::from_text(ctl).map_err(|_|"Invalid recovery witness controller pin")?;
    if c==Principal::anonymous() || c==Principal::management_canister() {return Err("Invalid recovery witness controller pin".into());}
    Ok((h,c))
}
pub fn check_witness_info(module:Option<&[u8]>,controllers:&[Principal],pin:&(Vec<u8>,Principal))->Result<(),String>{
    if module!=Some(pin.0.as_slice()) {return Err("Recovery witness program differs from pinned build".into());}
    if controllers!=[pin.1] {return Err("Recovery witness must be controlled only by the pinned recovery key".into());}
    Ok(())
}
pub fn witness() -> Result<Principal,String> {
    let text=option_env!("IGNITE_PRODUCTION_ACCOUNT_WITNESS").ok_or("Independent recovery witness not configured")?;
    let p=Principal::from_text(text).map_err(|_|"Invalid immutable recovery witness")?;
    if p==Principal::anonymous() || p==Principal::management_canister() {return Err("Invalid immutable recovery witness".into());}
    Ok(p)
}
pub fn request(a:&SignedApproval,request_id:u64,history_revision:u64,removal_generation:u64,identity_version:u64) -> Result<WitnessRequest,String> {
    let mut bytes=signing_bytes(&a.body)?;bytes.extend(&a.signature);
    Ok(WitnessRequest {identity:a.body.identity,generation:a.body.generation,recovery_epoch:a.body.recovery_epoch,
        signed_digest:Sha256::digest(bytes).to_vec(),request_id,history_revision,removal_generation,identity_version})
}
pub fn validate_witness(expected:&WitnessRequest,receipt:&WitnessReceipt) -> Result<(),String> {
    if expected!=&receipt.request {return Err("Exact independent recovery witness receipt required".into());} Ok(())
}
fn parse_key(value:&str) -> Result<VerifyingKey,String> {
    if value.len()!=64 || !value.is_ascii() { return Err("Invalid immutable production account signer".into()); }
    let mut bytes=[0u8;32];
    for (i,byte) in bytes.iter_mut().enumerate() { *byte=u8::from_str_radix(&value[i*2..i*2+2],16).map_err(|_|"Invalid immutable production account signer")?; }
    VerifyingKey::from_bytes(&bytes).map_err(|_|"Invalid immutable production account signer".into())
}
pub fn validate(approval:&SignedApproval,identity:Principal,operator:Principal,now:u64,key:&VerifyingKey) -> Result<(),String> {
    if !matches!(approval.body.kind.as_str(), KIND | FULL_KIND) { return Err("Signed account capability required".into()); }
    validate_kind(approval,identity,operator,now,key)
}
pub fn validate_inventory(approval:&SignedApproval,identity:Principal,operator:Principal,now:u64,key:&VerifyingKey)->Result<(),String> {
    if approval.body.kind!=INVENTORY_KIND {return Err("Separate signed inventory provisioning required".into());}
    validate_kind(approval,identity,operator,now,key)
}
fn validate_kind(approval:&SignedApproval,identity:Principal,operator:Principal,now:u64,key:&VerifyingKey) -> Result<(),String> {
    let b=&approval.body;
    bounds(b)?;
    if approval.signature.len()!=64 {return Err("Independent production account signature required".into());}
    if b.identity!=identity || b.expectation.identity!=identity ||
        b.operator!=operator || operator==Principal::anonymous() || operator==Principal::management_canister() ||
        b.generation==0 || b.recovery_epoch==0 || b.expires_at_ns<=now || b.review.release_authorized || b.review.recovery_accepted ||
        [&b.original_inventory_evidence,&b.runtime_evidence,&b.fenced_recovery_evidence].iter().any(|h|h.len()!=32 || h.iter().all(|v|*v==0)) {
        return Err("Exact signed production account evidence required".into());
    }
    let verified=crate::production_account_protection::verify(&b.expectation,&b.review.inventory,
        &b.review.lifecycle,&b.review.lifecycle,&b.review.configurations)?;
    if verified!=b.review { return Err("Signed review scope mismatch".into()); }
    let signature=Signature::from_slice(&approval.signature).map_err(|_|"Independent production account signature required")?;
    key.verify_strict(&signing_bytes(b)?,&signature).map_err(|_|"Independent production account signature required".into())
}
pub fn authorize(prior:&State,approval:&SignedApproval,identity:Principal,operator:Principal,now:u64,key:&VerifyingKey) -> Result<State,String> {
    validate(approval,identity,operator,now,key)?;
    if prior.approval.as_ref()==Some(approval) { return Ok(prior.clone()); }
    if approval.body.generation!=prior.generation.checked_add(1).ok_or("Authorization generation exhausted")? {
        return Err("Fresh exact authorization generation required".into());
    }
    Ok(State {generation:approval.body.generation,approval:Some(approval.clone())})
}
pub fn reader(state:&State,caller:Principal,now:u64) -> Result<&SignedApproval,String> {
    let a=state.approval.as_ref().ok_or("Service admission not released")?;
    if caller==Principal::anonymous() || a.body.generation!=state.generation || a.body.expires_at_ns<=now ||
        !a.body.review.account_readers.contains(&caller) { return Err("Configured production account reader required".into()); }
    Ok(a)
}
pub fn disable(prior:&State) -> Result<State,String> {
    Ok(State {generation:prior.generation.checked_add(1).ok_or("Authorization generation exhausted")?,approval:None})
}
pub fn removal_control(state:&State,identity:Principal,operator:Principal,now:u64,key:&VerifyingKey)->Result<(),String> {
    let a=state.approval.as_ref().ok_or("Signed production removal control required")?;
    validate(a,identity,operator,now,key)?;
    if a.body.kind!=FULL_KIND || a.body.generation!=state.generation {return Err("Signed production removal control required".into());}
    Ok(())
}

#[cfg(test)] mod tests {
    use super::*;
    use ed25519_dalek::{SigningKey,Signer};
    fn signed()->(SignedApproval,VerifyingKey) {
        let (expectation,lifecycle,configurations)=crate::production_account_protection::tests::fixture();
        let review=crate::production_account_protection::verify(&expectation,&expectation.inventory,&lifecycle,&lifecycle,&configurations).unwrap();
        let body=ApprovalBody {kind:KIND.into(),identity:expectation.identity,operator:Principal::from_slice(&[98,1]),generation:1,
            expires_at_ns:100,expectation,review,original_inventory_evidence:vec![1;32],runtime_evidence:vec![2;32],fenced_recovery_evidence:vec![3;32],recovery_epoch:1};
        let key=SigningKey::from_bytes(&[7;32]);let signature=key.sign(&signing_bytes(&body).unwrap()).to_bytes().to_vec();
        (SignedApproval {body,signature},key.verifying_key())
    }
    #[test] fn default_and_review_alone_never_grant_aliases() {
        let(a,_)=signed();assert_eq!(a.body.review.account_readers.len(),24);
        assert!(reader(&State::default(),a.body.review.account_readers[0],1).is_err());
        if option_env!("IGNITE_PRODUCTION_ACCOUNT_APPROVER_PUBLIC_KEY").is_none(){assert!(key().is_err());}
    }
    #[test] fn exact_signature_grants_only_24_readers_not_28_targets() {
        let(a,k)=signed();let s=authorize(&State::default(),&a,a.body.identity,a.body.operator,1,&k).unwrap();
        for target in &a.body.review.targets { assert_eq!(reader(&s,*target,1).is_ok(),a.body.review.account_readers.contains(target)); }
        assert!(reader(&s,Principal::anonymous(),1).is_err());assert!(reader(&s,a.body.identity,1).is_err());
        assert!(!a.body.review.release_authorized && !a.body.review.recovery_accepted);
    }
    #[test] fn signatures_bind_identity_operator_evidence_and_complete_review() {
        let(a,k)=signed();
        let check=|bad:&SignedApproval|validate(bad,a.body.identity,a.body.operator,1,&k);
        let mut bad=a.clone();bad.body.runtime_evidence[0]^=1;assert!(check(&bad).is_err());
        let mut bad=a.clone();bad.body.review.account_readers.push(a.body.identity);assert!(check(&bad).is_err());
        let mut bad=a.clone();bad.body.fenced_recovery_evidence.clear();assert!(check(&bad).is_err());
        let mut bad=a.clone();bad.body.review.recovery_accepted=true;assert!(check(&bad).is_err());
        let mut bad=a.clone();bad.signature.fill(0);assert!(check(&bad).is_err());
        assert!(validate(&a,a.body.operator,a.body.operator,1,&k).is_err());
        assert!(validate(&a,a.body.identity,a.body.identity,1,&k).is_err());
    }
    #[test] fn disable_expiry_and_aba_reject_old_signed_approval() {
        let(a,k)=signed();let s=authorize(&State::default(),&a,a.body.identity,a.body.operator,1,&k).unwrap();
        assert_eq!(authorize(&s,&a,a.body.identity,a.body.operator,1,&k).unwrap(),s);
        assert!(reader(&s,a.body.review.account_readers[0],100).is_err());
        let disabled=disable(&s).unwrap();assert_eq!(disabled.generation,2);
        assert!(authorize(&disabled,&a,a.body.identity,a.body.operator,1,&k).is_err());
        assert!(reader(&disabled,a.body.review.account_readers[0],1).is_err());
        let restored:State=crate::decode(&crate::encode(&s));assert_eq!(restored,s);
    }
    #[test] fn witness_rejects_old_request_epoch_generation_or_signed_digest() {
        let(a,_)=signed();let request=request(&a,8,10,3,4).unwrap();let receipt=WitnessReceipt {request:request.clone()};
        assert!(validate_witness(&request,&receipt).is_ok());
        let mut bad=receipt.clone();bad.request.request_id=7;assert!(validate_witness(&request,&bad).is_err());
        let mut bad=receipt.clone();bad.request.recovery_epoch=2;assert!(validate_witness(&request,&bad).is_err());
        let mut bad=receipt.clone();bad.request.generation=2;assert!(validate_witness(&request,&bad).is_err());
        let mut bad=receipt.clone();bad.request.history_revision=9;assert!(validate_witness(&request,&bad).is_err());
        let mut bad=receipt.clone();bad.request.removal_generation=2;assert!(validate_witness(&request,&bad).is_err());
        let mut bad=receipt.clone();bad.request.identity_version=3;assert!(validate_witness(&request,&bad).is_err());
        let mut bad=receipt;bad.request.signed_digest[0]^=1;assert!(validate_witness(&request,&bad).is_err());
        if option_env!("IGNITE_PRODUCTION_ACCOUNT_WITNESS").is_none(){assert!(witness().is_err());}
        if option_env!("IGNITE_PRODUCTION_ACCOUNT_WITNESS_MODULE_HASH").is_none(){assert!(witness_binding().is_err());}
        let pin=parse_binding(&"ab".repeat(32),"2vxsx-fae");assert!(pin.is_err());
        let ctl=Principal::from_slice(&[7;29]);let pin=parse_binding(&"ab".repeat(32),&ctl.to_text()).unwrap();
        assert!(check_witness_info(Some(&[0xab;32]),&[ctl],&pin).is_ok());
        assert!(check_witness_info(Some(&[0xac;32]),&[ctl],&pin).is_err());
        assert!(check_witness_info(None,&[ctl],&pin).is_err());
        assert!(check_witness_info(Some(&[0xab;32]),&[ctl,Principal::from_slice(&[8;29])],&pin).is_err());
        assert!(check_witness_info(Some(&[0xab;32]),&[],&pin).is_err());
        assert!(parse_binding(&"00".repeat(32),&ctl.to_text()).is_err());
    }
    #[test] fn oversized_nested_inputs_refuse_before_signing_and_authorization() {
        let(a,k)=signed();let mut bad=a.clone();bad.body.expectation.inventory.groups.binding.host="x".repeat(513);
        assert!(signing_bytes(&bad.body).is_err());assert!(authorize(&State::default(),&bad,a.body.identity,a.body.operator,1,&k).is_err());
        let mut bad=a.clone();bad.body.review.configurations.resize(155,bad.body.review.configurations[0].clone());assert!(signing_bytes(&bad.body).is_err());
        let mut bad=a;bad.signature.resize(65,0);assert!(validate(&bad,bad.body.identity,bad.body.operator,1,&k).is_err());
    }
    #[test] fn inventory_readers_and_full_removal_are_distinct_signed_purposes() {
        let (mut a,k)=signed();let signer=SigningKey::from_bytes(&[7;32]);
        let readers=authorize(&State::default(),&a,a.body.identity,a.body.operator,1,&k).unwrap();
        assert!(removal_control(&readers,a.body.identity,a.body.operator,1,&k).is_err());
        a.body.kind=INVENTORY_KIND.into();a.signature=signer.sign(&signing_bytes(&a.body).unwrap()).to_bytes().to_vec();
        assert!(validate_inventory(&a,a.body.identity,a.body.operator,1,&k).is_ok());
        assert!(authorize(&State::default(),&a,a.body.identity,a.body.operator,1,&k).is_err());
        a.body.kind=FULL_KIND.into();a.signature=signer.sign(&signing_bytes(&a.body).unwrap()).to_bytes().to_vec();
        assert!(validate_inventory(&a,a.body.identity,a.body.operator,1,&k).is_err());
        let full=authorize(&State::default(),&a,a.body.identity,a.body.operator,1,&k).unwrap();
        assert!(removal_control(&full,a.body.identity,a.body.operator,1,&k).is_ok());
        assert!(removal_control(&full,a.body.identity,a.body.operator,100,&k).is_err());
        assert!(removal_control(&disable(&full).unwrap(),a.body.identity,a.body.operator,1,&k).is_err());
    }
}