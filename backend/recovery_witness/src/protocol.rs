//! Independent recovery ledger. Never included in participant backup sets.
//! A restored ledger cannot grant reads: the host also checks its live management lifecycle count.
use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use ed25519_dalek::{Signature, VerifyingKey};
use std::collections::BTreeSet;
pub type Outcome<T> = Result<T, String>;
pub const MAX_TARGETS: usize = 154;

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct WitnessRequest {
    pub identity: Principal, pub generation: u64, pub recovery_epoch: u64,
    pub signed_digest: Vec<u8>, pub request_id: u64,
    pub history_revision: u64, pub removal_generation: u64, pub identity_version: u64,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct WitnessReceipt { pub request: WitnessRequest }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccountReadRequest {
    pub request: WitnessRequest, pub account_id: String, pub subjects: Vec<Principal>,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccountReadReceipt { pub request: AccountReadRequest }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Participant { pub canister: Principal, pub module: Vec<u8>, pub changes: u64 }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Acceptance {
    // Wire names retained for compatibility; v2 signs live management change counts.
    pub witness: Principal, pub witness_version: u64, pub identity: Principal,
    pub epoch: u64, pub journal_revision: u64, pub journal_digest: Vec<u8>,
    pub inventory_digest: Vec<u8>, pub decoded_history_digest: Vec<u8>,
    pub generation: u64, pub signed_digest: Vec<u8>, pub expires_at_ns: u64,
    pub history_revision: u64, pub removal_generation: u64, pub identity_version: u64,
    pub participants: Vec<Participant>,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct SignedAcceptance { pub body: Acceptance, pub signature: Vec<u8> }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Removal {
    pub account_id: String, pub generation: u64, pub inventory_digest: Vec<u8>,
    pub subjects: Vec<Principal>, pub targets: Vec<Principal>,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub enum Progress { Prepared { target: Principal }, Sealed { target: Principal }, Completed }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub enum Event { Removal(Removal), Progress { account_id: String, generation: u64, progress: Progress }, Disable { identity: Principal, generation: u64 } }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Record { pub operation_id: String, pub event: Event }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Head { pub epoch: u64, pub revision: u64, pub digest: Vec<u8>, pub accepted: Option<SignedAcceptance> }
impl Default for Head {
    fn default() -> Self { Self { epoch: 1, revision: 0, digest: vec![0;32], accepted: None } }
}
pub fn hash_ok(h: &[u8]) -> bool { h.len()==32 && h.iter().any(|b|*b!=0) }
pub fn principal_ok(p: Principal) -> bool { p!=Principal::anonymous() && p!=Principal::management_canister() }
pub fn unique(ps: &[Principal]) -> bool {
    !ps.is_empty() && ps.len()<=MAX_TARGETS && ps.iter().all(|p|principal_ok(*p)) && ps.iter().copied().collect::<BTreeSet<_>>().len()==ps.len()
}
pub fn validate_record(r: &Record) -> Outcome<()> {
    if r.operation_id.is_empty() || r.operation_id.len()>128 { return Err("Bounded immutable operation ID required".into()); }
    let (account,generation)=match &r.event {
        Event::Removal(m) => {
            if !hash_ok(&m.inventory_digest) || !unique(&m.subjects) || m.targets.is_empty() || m.targets.len()>1088 ||
                m.targets.iter().any(|p|!principal_ok(*p)) || m.targets.iter().copied().collect::<BTreeSet<_>>().len()!=m.targets.len() { return Err("Exact removal inventory and subjects required".into()); }
            (&m.account_id,m.generation)
        },
        Event::Progress {account_id,generation,..} => (account_id,*generation),
        Event::Disable {identity,generation} => {
            if !principal_ok(*identity)||*generation==0 {return Err("Exact disable identity and generation required".into());}
            return Ok(());
        },
    };
    if account.is_empty() || account.len()>128 || generation==0 { return Err("Exact removal account and generation required".into()); }
    Ok(())
}
pub fn advance(head: &Head, r: &Record) -> Outcome<Head> {
    validate_record(r)?;
    let mut bytes=head.digest.clone();
    bytes.extend(candid::encode_one(r).map_err(|_|"Invalid recovery record")?);
    Ok(Head {epoch:head.epoch.checked_add(1).ok_or("Recovery epoch exhausted")?,
        revision:head.revision.checked_add(1).ok_or("Recovery journal exhausted")?,
        digest:Sha256::digest(bytes).to_vec(),accepted:None})
}
pub fn close(head:&Head)->Outcome<Head> {
    Ok(Head {epoch:head.epoch.checked_add(1).ok_or("Recovery epoch exhausted")?, accepted:None,..head.clone()})
}
pub fn signing_bytes(b: &Acceptance)->Outcome<Vec<u8>> {
    if b.participants.len()<2 || b.participants.len()>MAX_TARGETS+1 ||
        b.participants.iter().any(|p|!principal_ok(p.canister)) ||
        b.participants.iter().map(|p|p.canister).collect::<BTreeSet<_>>().len()!=b.participants.len() ||
        b.participants.iter().any(|p|!hash_ok(&p.module)) ||
        [&b.inventory_digest,&b.decoded_history_digest,&b.signed_digest].iter().any(|h|!hash_ok(h)) ||
        b.journal_digest.len()!=32 || !principal_ok(b.identity) || !principal_ok(b.witness) ||
        b.identity==b.witness || b.participants.iter().any(|p|p.canister==b.witness) ||
        b.witness_version==0 || !b.participants.iter().any(|p|p.canister==b.identity && p.changes==b.identity_version) {return Err("Exact bounded independent recovery scope required".into());}
    let mut result=b"ignite:independent-recovery-acceptance:lifecycle-v2\0".to_vec();
    result.extend(Sha256::digest(candid::encode_one(b).map_err(|_|"Invalid recovery acceptance")?)); Ok(result)
}
pub fn accept(head:&Head,a:&SignedAcceptance,witness:Principal,version:u64,now:u64,key:&VerifyingKey)->Outcome<Head> {
    let b=&a.body; let bytes=signing_bytes(b)?;
    if b.witness!=witness || b.witness_version!=version || b.epoch!=head.epoch || b.journal_revision!=head.revision ||
        b.journal_digest!=head.digest || b.generation==0 || b.expires_at_ns<=now || a.signature.len()!=64 { return Err("Current exact independent recovery acceptance required".into()); }
    let signature=Signature::from_slice(&a.signature).map_err(|_|"Recovery signature required")?;
    key.verify_strict(&bytes,&signature).map_err(|_|"Independent recovery signature required")?;
    Ok(Head {accepted:Some(a.clone()),..head.clone()})
}
pub fn verify(head:&Head,r:&WitnessRequest,caller:Principal,now:u64)->Outcome<WitnessReceipt> {
    let a=&head.accepted.as_ref().ok_or("Recovery remains fenced")?.body;
    if caller!=a.identity || caller!=r.identity || !principal_ok(caller) || r.request_id==0 ||
        a.epoch!=head.epoch || r.recovery_epoch!=head.epoch || r.generation!=a.generation ||
        r.signed_digest!=a.signed_digest || r.history_revision!=a.history_revision ||
        r.removal_generation!=a.removal_generation || r.identity_version!=a.identity_version ||
        a.journal_revision!=head.revision || a.journal_digest!=head.digest || a.expires_at_ns<=now {
        return Err("Current exact recovery fence required".into());
    } Ok(WitnessReceipt {request:r.clone()})
}
/// Ordinary journal progress cannot widen this immutable signed baseline.
/// Subject/account tombstones are checked separately by the stable witness.
pub fn verify_account_baseline(a:&SignedAcceptance,r:&AccountReadRequest,caller:Principal,now:u64)->Outcome<AccountReadReceipt> {
    let b=&a.body;let q=&r.request;
    if caller!=b.identity || caller!=q.identity || !principal_ok(caller) || q.request_id==0 ||
        q.generation!=b.generation || q.recovery_epoch!=b.epoch || q.signed_digest!=b.signed_digest ||
        q.identity_version!=b.identity_version || q.history_revision<b.history_revision || q.removal_generation<b.removal_generation ||
        b.expires_at_ns<=now || r.account_id.is_empty() || r.account_id.len()>128 ||
        r.subjects.len()>8 || !unique(&r.subjects) {
        return Err("Current exact subject recovery baseline required".into());
    }
    Ok(AccountReadReceipt {request:r.clone()})
}
pub fn subject_progress_signing_bytes(b:&Acceptance)->Outcome<Vec<u8>> {
    let canonical=signing_bytes(b)?;
    let mut bytes=b"ignite:subject-scoped-removal-progress:lifecycle-v2\0".to_vec();
    bytes.extend(Sha256::digest(canonical));Ok(bytes)
}
pub fn validate_subject_progress(a:&SignedAcceptance,key:&VerifyingKey)->Outcome<()> {
    let signature=Signature::from_slice(&a.signature).map_err(|_|"Separate subject progress signature required")?;
    key.verify_strict(&subject_progress_signing_bytes(&a.body)?,&signature).map_err(|_|"Separate subject progress signature required".into())
}

#[cfg(test)] mod tests {
    use super::*;
    use ed25519_dalek::{Signer,SigningKey};
    fn p(n:u8)->Principal {Principal::from_slice(&[n,1])}
    fn fixture()->(Head,SignedAcceptance,VerifyingKey,WitnessRequest) {
        let head=Head::default(); let body=Acceptance {witness:p(1),witness_version:4,identity:p(2),epoch:1,journal_revision:0,journal_digest:head.digest.clone(),
            inventory_digest:vec![1;32],decoded_history_digest:vec![2;32],generation:1,signed_digest:vec![3;32],expires_at_ns:100,
            history_revision:8,removal_generation:3,identity_version:7,participants:vec![Participant {canister:p(2),module:vec![4;32],changes:7},Participant {canister:p(3),module:vec![5;32],changes:2}]};
        let key=SigningKey::from_bytes(&[8;32]);let signature=key.sign(&signing_bytes(&body).unwrap()).to_bytes().to_vec();
        let a=SignedAcceptance {body,signature};let req=WitnessRequest {identity:p(2),generation:1,recovery_epoch:1,signed_digest:vec![3;32],request_id:1,history_revision:8,removal_generation:3,identity_version:7};
        (head,a,key.verifying_key(),req)
    }
    fn removal()->Record {Record {operation_id:"remove-1".into(),event:Event::Removal(Removal {account_id:"account".into(),generation:3,inventory_digest:vec![1;32],subjects:vec![p(7),p(8)],targets:vec![p(3),p(4)]})}}
    #[test] fn closed_by_default_and_only_exact_signed_acceptance_grants_reads() {
        let(h,a,k,r)=fixture();assert!(verify(&h,&r,r.identity,1).is_err());
        let s=accept(&h,&a,p(1),4,1,&k).unwrap();assert_eq!(verify(&s,&r,r.identity,1).unwrap().request,r);
        assert!(verify(&s,&r,p(9),1).is_err());assert!(verify(&s,&r,r.identity,100).is_err());
    }
    #[test] fn restoring_identity_history_version_or_generation_is_denied() {
        let(h,a,k,r)=fixture();let s=accept(&h,&a,p(1),4,1,&k).unwrap();
        for field in 0..5 {let mut bad=r.clone();match field {0=>bad.history_revision-=1,1=>bad.removal_generation-=1,2=>bad.identity_version-=1,3=>bad.recovery_epoch+=1,_=>bad.generation+=1};assert!(verify(&s,&bad,r.identity,1).is_err());}
    }
    #[test] fn removal_and_progress_close_reads_and_prevent_old_checkpoint_acceptance() {
        let(h,a,k,r)=fixture();let s=accept(&h,&a,p(1),4,1,&k).unwrap();let removal=removal();
        let advanced=advance(&s,&removal).unwrap();assert!(verify(&advanced,&r,r.identity,1).is_err());assert!(accept(&advanced,&a,p(1),4,1,&k).is_err());
        let progress=Record {operation_id:"seal-1".into(),event:Event::Progress {account_id:"account".into(),generation:3,progress:Progress::Sealed {target:p(3)}}};
        let next=advance(&advanced,&progress).unwrap();assert_eq!(next.revision,2);assert_ne!(advanced.digest,next.digest);
    }
    #[test] fn witness_restore_or_upgrade_version_never_reuses_old_acceptance() {
        let(h,a,k,_)=fixture();assert!(accept(&h,&a,p(1),5,1,&k).is_err());
        assert!(accept(&close(&h).unwrap(),&a,p(1),4,1,&k).is_err());
    }
    #[test] fn old_runtime_version_signatures_cannot_authorize_lifecycle_v2() {
        let(h,mut a,k,_)=fixture();
        let mut bytes=b"ignite:independent-recovery-acceptance:v1\0".to_vec();
        bytes.extend(Sha256::digest(candid::encode_one(&a.body).unwrap()));
        a.signature=SigningKey::from_bytes(&[8;32]).sign(&bytes).to_bytes().to_vec();
        assert!(accept(&h,&a,p(1),4,1,&k).is_err());
    }
    #[test] fn identity_lifecycle_must_match_the_signed_participant() {
        let(_,mut a,_,_)=fixture();a.body.identity_version=8;
        assert!(signing_bytes(&a.body).is_err());
    }
    #[test] fn signatures_bind_complete_inventory_history_and_journal() {
        let(h,a,k,_)=fixture();for field in 0..3 {let mut b=a.clone();match field {0=>b.body.decoded_history_digest[0]^=1,1=>b.body.participants[1].module[0]^=1,_=>b.body.inventory_digest[0]^=1};assert!(accept(&h,&b,p(1),4,1,&k).is_err());}
        let mut b=a;b.body.participants.push(b.body.participants[0].clone());assert!(signing_bytes(&b.body).is_err());
    }
    #[test] fn bounded_records_and_exhaustion_refuse_before_mutation() {
        let mut r=removal();r.operation_id="x".repeat(129);assert!(advance(&Head::default(),&r).is_err());
        assert!(advance(&Head {epoch:u64::MAX,..Head::default()},&removal()).is_err());
    }
    #[test] fn full_participant_budget_accepts_155_and_rejects_156_or_duplicates() {
        let(_,a,_,_)=fixture();let mut b=a.body;
        b.participants=(0..155u16).map(|n|Participant {canister:Principal::from_slice(&[9,(n/256)as u8,(n%256)as u8,1]),module:vec![4;32],changes:1}).collect();
        b.identity=b.participants[0].canister;b.identity_version=1;assert!(signing_bytes(&b).is_ok());
        b.participants.push(Participant {canister:p(99),module:vec![4;32],changes:1});assert!(signing_bytes(&b).is_err());
        b.participants.pop();b.participants[1]=b.participants[0].clone();assert!(signing_bytes(&b).is_err());
    }
    #[test] fn removal_inventory_supports_1088_targets_but_not_1089() {
        let mut r=removal();if let Event::Removal(m)=&mut r.event {
            m.targets=(0..1088u16).map(|n|Principal::from_slice(&[9,(n/256)as u8,(n%256)as u8,1])).collect();
        }
        assert!(validate_record(&r).is_ok());
        if let Event::Removal(m)=&mut r.event {m.targets.push(p(99));}assert!(validate_record(&r).is_err());
    }
    #[test] fn survivor_baseline_allows_forward_progress_not_restore_expiry_or_foreign_identity() {
        let(_,a,_,q)=fixture();let mut r=AccountReadRequest {request:q,account_id:"survivor".into(),subjects:vec![p(9)]};
        assert!(verify_account_baseline(&a,&r,p(2),1).is_ok());
        r.request.history_revision+=20;r.request.removal_generation+=1;
        assert!(verify_account_baseline(&a,&r,p(2),1).is_ok());
        assert!(verify_account_baseline(&a,&r,p(9),1).is_err());
        assert!(verify_account_baseline(&a,&r,p(2),100).is_err());
        r.request.identity_version+=1;assert!(verify_account_baseline(&a,&r,p(2),1).is_err());
        r.request.identity_version-=1;r.request.history_revision=7;assert!(verify_account_baseline(&a,&r,p(2),1).is_err());
    }
    #[test] fn old_recovery_signature_cannot_activate_subject_progress_policy() {
        let(_,mut a,k,_)=fixture();assert!(validate_subject_progress(&a,&k).is_err());
        let key=SigningKey::from_bytes(&[8;32]);
        a.signature=key.sign(&subject_progress_signing_bytes(&a.body).unwrap()).to_bytes().to_vec();
        assert!(validate_subject_progress(&a,&k).is_ok());
        a.body.generation+=1;assert!(validate_subject_progress(&a,&k).is_err());
    }
}