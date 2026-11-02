//! Separately governed anti-rollback witness; no deployment or opening path.
mod protocol;
use protocol::*;
use candid::Principal;
use ic_stable_structures::{memory_manager::{MemoryId,MemoryManager,VirtualMemory},DefaultMemoryImpl,StableCell,StableBTreeMap};
use std::cell::RefCell;
use ed25519_dalek::VerifyingKey;
type Memory=VirtualMemory<DefaultMemoryImpl>;
const MAX_RECORDS:u64=1_000_000;
thread_local! {
    static MEMORY:RefCell<MemoryManager<DefaultMemoryImpl>>=RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));
    static GOVERNOR:RefCell<StableCell<Vec<u8>,Memory>>=RefCell::new(StableCell::init(MEMORY.with(|m|m.borrow().get(MemoryId::new(0))),vec![]));
    static HEAD:RefCell<StableCell<Vec<u8>,Memory>>=RefCell::new(StableCell::init(MEMORY.with(|m|m.borrow().get(MemoryId::new(1))),vec![]));
    static RECORDS:RefCell<StableBTreeMap<u64,Vec<u8>,Memory>>=RefCell::new(StableBTreeMap::init(MEMORY.with(|m|m.borrow().get(MemoryId::new(2)))));
    static OPERATIONS:RefCell<StableBTreeMap<String,u64,Memory>>=RefCell::new(StableBTreeMap::init(MEMORY.with(|m|m.borrow().get(MemoryId::new(3)))));
    static REMOVALS:RefCell<StableBTreeMap<String,Vec<u8>,Memory>>=RefCell::new(StableBTreeMap::init(MEMORY.with(|m|m.borrow().get(MemoryId::new(4)))));
    static PROGRESS:RefCell<StableBTreeMap<String,u8,Memory>>=RefCell::new(StableBTreeMap::init(MEMORY.with(|m|m.borrow().get(MemoryId::new(5)))));
    // IC version is external to loaded application snapshots. Zero means closed.
    static ARMED_VERSION:RefCell<StableCell<u64,Memory>>=RefCell::new(StableCell::init(MEMORY.with(|m|m.borrow().get(MemoryId::new(6))),0));
    static IDENTITY:RefCell<StableCell<Vec<u8>,Memory>>=RefCell::new(StableCell::init(MEMORY.with(|m|m.borrow().get(MemoryId::new(7))),vec![]));
    static EVENTS:RefCell<StableBTreeMap<Vec<u8>,u64,Memory>>=RefCell::new(StableBTreeMap::init(MEMORY.with(|m|m.borrow().get(MemoryId::new(8)))));
}
fn event_key(event:&Event)->Vec<u8> {use sha2::{Digest,Sha256};Sha256::digest(candid::encode_one(event).expect("bounded recovery event")).to_vec()}
fn encode<T:serde::Serialize>(v:&T)->Vec<u8> {let mut b=vec![];ciborium::ser::into_writer(v,&mut b).expect("encode witness state");b}
fn decode<T:serde::de::DeserializeOwned>(b:&[u8])->T {ciborium::de::from_reader(b).expect("decode witness state")}
fn head()->Head {HEAD.with(|h|if h.borrow().get().is_empty(){Head::default()}else{decode(h.borrow().get())})}
fn save(h:&Head){HEAD.with(|s|s.borrow_mut().set(encode(h)));}
fn governor()->Principal {GOVERNOR.with(|g|if g.borrow().get().is_empty(){Principal::anonymous()}else{Principal::from_slice(g.borrow().get())})}
fn identity()->Principal {IDENTITY.with(|g|if g.borrow().get().is_empty(){Principal::anonymous()}else{Principal::from_slice(g.borrow().get())})}
fn require_governor()->Outcome<()> {if !principal_ok(ic_cdk::api::msg_caller())||ic_cdk::api::msg_caller()!=governor(){return Err("Witness governor required".into());}Ok(())}
fn signer()->Outcome<VerifyingKey> {
    let text=option_env!("IGNITE_RECOVERY_APPROVER_PUBLIC_KEY").ok_or("Independent recovery signer not pinned")?;
    if text.len()!=64||!text.is_ascii(){return Err("Invalid immutable recovery signer".into());}
    let mut key=[0;32];for (i,b) in key.iter_mut().enumerate(){*b=u8::from_str_radix(&text[i*2..i*2+2],16).map_err(|_|"Invalid recovery signer")?;}
    VerifyingKey::from_bytes(&key).map_err(|_|"Invalid recovery signer".into())
}
#[derive(candid::CandidType,serde::Deserialize)]
pub struct Init {pub governor:Principal,pub identity:Principal}
#[ic_cdk::init]
fn init(arg:Init) {
    if !principal_ok(arg.governor)||!principal_ok(arg.identity)||arg.identity==ic_cdk::api::canister_self(){ic_cdk::trap("Independent witness identities required");}
    GOVERNOR.with(|g|g.borrow_mut().set(arg.governor.as_slice().to_vec()));
    IDENTITY.with(|g|g.borrow_mut().set(arg.identity.as_slice().to_vec()));save(&Head::default());
}
#[ic_cdk::post_upgrade]
fn post_upgrade(){ARMED_VERSION.with(|v|v.borrow_mut().set(0));}
#[ic_cdk::update]
fn read_recovery_head()->Outcome<Head> {require_governor()?;Ok(head())}
#[ic_cdk::update]
fn read_recovery_runtime_version()->Outcome<u64> {require_governor()?;Ok(ic_cdk::api::canister_version())}
#[ic_cdk::update]
fn recovery_acceptance_signing_bytes(body:Acceptance)->Outcome<Vec<u8>> {require_governor()?;signing_bytes(&body)}
#[ic_cdk::update]
fn read_recovery_records(after:u64,limit:u16)->Outcome<Vec<(u64,Record)>> {
    require_governor()?;if limit==0||limit>200{return Err("Recovery pages are bounded to 200".into());}
    Ok(RECORDS.with(|m|m.borrow().range((std::ops::Bound::Excluded(after),std::ops::Bound::Unbounded)).take(limit as usize).map(|e|(*e.key(),decode(&e.value()))).collect()))
}
// Claims never authorize recovery: only independently signed decoded-history
// acceptance can do so. Store whole replayable records, not only hashes.
#[ic_cdk::update]
fn record_removal_recovery(r:Record)->Outcome<u64> {
    let caller=ic_cdk::api::msg_caller();if !principal_ok(caller)||(caller!=identity()&&caller!=governor()){return Err("Pinned removal coordinator required".into());}
    validate_record(&r)?;
    if let Some(revision)=OPERATIONS.with(|m|m.borrow().get(&r.operation_id)) {
        let prior:Record=RECORDS.with(|m|decode(&m.borrow().get(&revision).expect("indexed recovery record")));
        return if prior==r {Ok(revision)}else{Err("Immutable recovery operation conflict".into())};
    }
    let semantic_key=event_key(&r.event);
    if let Some(revision)=EVENTS.with(|m|m.borrow().get(&semantic_key)) {return Ok(revision);}
    if RECORDS.with(|m|m.borrow().len())>=MAX_RECORDS{return Err("Recovery journal capacity reached; keep closed".into());}
    match &r.event {
        Event::Removal(m)=>{
            if m.subjects.contains(&identity())||m.targets.contains(&ic_cdk::api::canister_self()){return Err("Witness cannot be a removal participant".into());}
            if let Some(bytes)=REMOVALS.with(|s|s.borrow().get(&m.account_id)) {let prior:Removal=decode(&bytes);if prior!=*m{return Err("Immutable removal conflict".into());}}
        },
        Event::Progress {account_id,generation,progress}=>{
            let removal:Removal=REMOVALS.with(|m|m.borrow().get(account_id)).map(|b|decode(&b)).ok_or("Journal removal before progress")?;
            if removal.generation!=*generation{return Err("Exact removal generation required".into());}
            match progress {
                Progress::Prepared {target}|Progress::Sealed {target}=>{
                    if !removal.targets.contains(target){return Err("Progress target outside retained inventory".into());}
                    if matches!(progress,Progress::Prepared {..}) && PROGRESS.with(|m|m.borrow().get(&format!("{}:{}",account_id,target.to_text())))==Some(2) {return Err("Sealed recovery progress cannot regress".into());}
                },
                Progress::Completed=>for target in &removal.targets {if PROGRESS.with(|m|m.borrow().get(&format!("{}:{}",account_id,target.to_text())))!=Some(2){return Err("Every retained target must be sealed".into());}},
            }
        }
    }
    let next=advance(&head(),&r)?;
    match &r.event {
        Event::Removal(m)=>{REMOVALS.with(|s|s.borrow_mut().insert(m.account_id.clone(),encode(m)));},
        Event::Progress {account_id,progress,..}=>{match progress {
            Progress::Prepared {target}|Progress::Sealed {target}=>{
                let key=format!("{}:{}",account_id,target.to_text());let phase=if matches!(progress,Progress::Sealed {..}){2}else{1};
                PROGRESS.with(|m|{let mut m=m.borrow_mut();let prior=m.get(&key).unwrap_or(0);m.insert(key,prior.max(phase));});
            },Progress::Completed=>{}
        }}
    }
    RECORDS.with(|m|m.borrow_mut().insert(next.revision,encode(&r)));
    OPERATIONS.with(|m|m.borrow_mut().insert(r.operation_id.clone(),next.revision));
    EVENTS.with(|m|m.borrow_mut().insert(semantic_key,next.revision));
    ARMED_VERSION.with(|v|v.borrow_mut().set(0));save(&next);Ok(next.revision)
}
#[ic_cdk::update]
fn close_recovery_fence(expected_epoch:u64)->Outcome<u64> {
    let caller=ic_cdk::api::msg_caller();if caller!=identity(){require_governor()?;}
    let prior=head();if prior.epoch!=expected_epoch{return Err("Exact recovery epoch required".into());}
    let next=close(&prior)?;ARMED_VERSION.with(|v|v.borrow_mut().set(0));save(&next);Ok(next.epoch)
}
async fn check_participants(a:&Acceptance)->Outcome<()> {
    for p in &a.participants {
        let info=ic_cdk::management_canister::canister_info(&ic_cdk::management_canister::CanisterInfoArgs {canister_id:p.canister,num_requested_changes:Some(0)})
            .await.map_err(|_|"Recovery participant unavailable")?;
        if info.module_hash.as_ref()!=Some(&p.module)||info.total_num_changes!=p.changes{return Err("Recovery participant lifecycle changed".into());}
    }Ok(())
}
#[ic_cdk::update]
async fn accept_recovery_fence(a:SignedAcceptance)->Outcome<u64> {
    require_governor()?;
    if a.body.identity!=identity(){return Err("Pinned recovery identity required".into());}
    let prior=head();let version=ic_cdk::api::canister_version();
    let next=accept(&prior,&a,ic_cdk::api::canister_self(),version,ic_cdk::api::time(),&signer()?)?;
    // Independent signer must have accepted decoded histories and exclusive
    // controller fencing before signing. Lifecycle sampling cannot replace it.
    for _ in 0..2 {check_participants(&a.body).await?;require_governor()?;
        if head()!=prior||ic_cdk::api::canister_version()!=version{return Err("Recovery changed during acceptance".into());}}
    ARMED_VERSION.with(|v|v.borrow_mut().set(version));save(&next);Ok(next.epoch)
}
#[ic_cdk::update]
async fn verify_production_account_read_fence(r:WitnessRequest)->Outcome<WitnessReceipt> {
    let caller=ic_cdk::api::msg_caller();let captured=head();
    let receipt=verify(&captured,&r,caller,ic_cdk::api::time())?;
    let version=ic_cdk::api::canister_version();
    if ARMED_VERSION.with(|v|*v.borrow().get())!=version{return Err("Witness restored or upgraded; independent reacceptance required".into());}
    let a=&captured.accepted.as_ref().ok_or("Recovery fenced")?.body;
    check_participants(a).await?;
    if head()!=captured||ic_cdk::api::canister_version()!=version{return Err("Recovery fence changed during read".into());}
    verify(&captured,&r,caller,ic_cdk::api::time())?;Ok(receipt)
}
pub fn candid_interface()->String {__export_service()}
ic_cdk::export_candid!();
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn export_contract_when_requested(){if std::env::var_os("IGNITE_EXPORT_CANDID").is_some(){std::fs::write(concat!(env!("CARGO_MANIFEST_DIR"),"/recovery_witness.did"),super::__export_service()).unwrap();}}
    #[test] fn journal_keeps_both_group_progress_and_idempotent_retries(){
        let memory=DefaultMemoryImpl::default();let manager=MemoryManager::init(memory.clone());
        let mut records=StableBTreeMap::<u64,Vec<u8>,_>::init(manager.get(MemoryId::new(2)));
        let record=Record {operation_id:"base/seal".into(),event:Event::Progress {account_id:"removed".into(),generation:1,progress:Progress::Sealed {target:Principal::from_slice(&[3,1])}}};
        records.insert(1,encode(&record));drop(records);drop(manager);
        let manager=MemoryManager::init(memory);let reopened=StableBTreeMap::<u64,Vec<u8>,_>::init(manager.get(MemoryId::new(2)));
        assert_eq!(decode::<Record>(&reopened.get(&1).unwrap()),record);
    }
    #[test] fn equivalent_events_have_same_semantic_identity_despite_retry_ids(){
        let event=Event::Progress {account_id:"removed".into(),generation:1,progress:Progress::Sealed {target:Principal::from_slice(&[3,1])}};
        let a=Record {operation_id:"retry-a".into(),event:event.clone()};let b=Record {operation_id:"retry-b".into(),event};
        assert_eq!(event_key(&a.event),event_key(&b.event));
        let mut other=b;other.event=Event::Progress {account_id:"removed".into(),generation:1,progress:Progress::Prepared {target:Principal::from_slice(&[3,1])}};
        assert_ne!(event_key(&a.event),event_key(&other.event));
    }
}