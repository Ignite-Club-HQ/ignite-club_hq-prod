//! Separate, signed account-read capability. A review draft cannot grant it.
//! The independent signer attests exact inventory provenance and externally
//! fenced recovery/runtime evidence. No signer is supplied by the caller.
use candid::{CandidType, Principal};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use crate::production_account_protection::{Draft, Expectation};

pub const KIND: &str = "ignite-production-account-readers-v1";
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
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct SignedApproval { pub body: ApprovalBody, pub signature: Vec<u8> }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct State { pub generation: u64, pub approval: Option<SignedApproval> }
impl Default for State { fn default() -> Self { Self { generation:0, approval:None } } }

pub fn signing_bytes(body: &ApprovalBody) -> Result<Vec<u8>, String> {
    let bytes=candid::encode_one(body).map_err(|_|"Invalid production approval encoding")?;
    if bytes.len()>1_048_576 { return Err("Production approval exceeds bounded budget".into()); }
    let mut payload=b"ignite:production-account-authorization:v1\0".to_vec();
    payload.extend(Sha256::digest(bytes)); Ok(payload)
}
pub fn key() -> Result<VerifyingKey,String> {
    parse_key(option_env!("IGNITE_PRODUCTION_ACCOUNT_APPROVER_PUBLIC_KEY").ok_or("Independent production account signer not configured")?)
}
fn parse_key(value:&str) -> Result<VerifyingKey,String> {
    if value.len()!=64 || !value.is_ascii() { return Err("Invalid immutable production account signer".into()); }
    let mut bytes=[0u8;32];
    for (i,byte) in bytes.iter_mut().enumerate() { *byte=u8::from_str_radix(&value[i*2..i*2+2],16).map_err(|_|"Invalid immutable production account signer")?; }
    VerifyingKey::from_bytes(&bytes).map_err(|_|"Invalid immutable production account signer".into())
}
pub fn validate(approval:&SignedApproval,identity:Principal,operator:Principal,now:u64,key:&VerifyingKey) -> Result<(),String> {
    let b=&approval.body;
    if b.kind!=KIND || b.identity!=identity || b.expectation.identity!=identity ||
        b.operator!=operator || operator==Principal::anonymous() || operator==Principal::management_canister() ||
        b.generation==0 || b.expires_at_ns<=now || b.review.release_authorized || b.review.recovery_accepted ||
        [&b.original_inventory_evidence,&b.runtime_evidence,&b.fenced_recovery_evidence].iter().any(|h|h.len()!=32 || h.iter().all(|v|*v==0)) {
        return Err("Exact signed production account evidence required".into());
    }
    let verified=crate::production_account_protection::verify(&b.expectation,&b.review.inventory,
        &b.review.lifecycle,&b.review.lifecycle,&b.review.configurations)?;
    if verified!=b.review { return Err("Signed review scope mismatch".into()); }
    let signature=Signature::from_slice(&approval.signature).map_err(|_|"Independent production account signature required")?;
    key.verify_strict(&signing_bytes(b)?,&signature).map_err(|_|"Independent production account signature required".into())
}
pub fn authorize(prior:&State,approval:SignedApproval,identity:Principal,operator:Principal,now:u64,key:&VerifyingKey) -> Result<State,String> {
    validate(&approval,identity,operator,now,key)?;
    if prior.approval.as_ref()==Some(&approval) { return Ok(prior.clone()); }
    if approval.body.generation!=prior.generation.checked_add(1).ok_or("Authorization generation exhausted")? {
        return Err("Fresh exact authorization generation required".into());
    }
    Ok(State {generation:approval.body.generation,approval:Some(approval)})
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

#[cfg(test)] mod tests {
    use super::*;
    use ed25519_dalek::{SigningKey,Signer};
    fn signed()->(SignedApproval,VerifyingKey) {
        let (expectation,lifecycle,configurations)=crate::production_account_protection::tests::fixture();
        let review=crate::production_account_protection::verify(&expectation,&expectation.inventory,&lifecycle,&lifecycle,&configurations).unwrap();
        let body=ApprovalBody {kind:KIND.into(),identity:expectation.identity,operator:Principal::from_slice(&[98,1]),generation:1,
            expires_at_ns:100,expectation,review,original_inventory_evidence:vec![1;32],runtime_evidence:vec![2;32],fenced_recovery_evidence:vec![3;32]};
        let key=SigningKey::from_bytes(&[7;32]);let signature=key.sign(&signing_bytes(&body).unwrap()).to_bytes().to_vec();
        (SignedApproval {body,signature},key.verifying_key())
    }
    #[test] fn default_and_review_alone_never_grant_aliases() {
        let(a,_)=signed();assert_eq!(a.body.review.account_readers.len(),24);
        assert!(reader(&State::default(),a.body.review.account_readers[0],1).is_err());
        if option_env!("IGNITE_PRODUCTION_ACCOUNT_APPROVER_PUBLIC_KEY").is_none(){assert!(key().is_err());}
    }
    #[test] fn exact_signature_grants_only_24_readers_not_28_targets() {
        let(a,k)=signed();let s=authorize(&State::default(),a.clone(),a.body.identity,a.body.operator,1,&k).unwrap();
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
        let(a,k)=signed();let s=authorize(&State::default(),a.clone(),a.body.identity,a.body.operator,1,&k).unwrap();
        assert_eq!(authorize(&s,a.clone(),a.body.identity,a.body.operator,1,&k).unwrap(),s);
        assert!(reader(&s,a.body.review.account_readers[0],100).is_err());
        let disabled=disable(&s).unwrap();assert_eq!(disabled.generation,2);
        assert!(authorize(&disabled,a.clone(),a.body.identity,a.body.operator,1,&k).is_err());
        assert!(reader(&disabled,a.body.review.account_readers[0],1).is_err());
        let restored:State=crate::decode(&crate::encode(&s));assert_eq!(restored,s);
    }
}