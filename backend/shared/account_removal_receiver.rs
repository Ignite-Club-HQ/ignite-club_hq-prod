//! Infrastructure account-removal receiver, wire-compatible with the Motoko
//! `RemovalReceiver` gate. A receipt is receiver-local evidence, never global
//! completion, erasure or opening authority.
//!
//! Host contract: the crate defines `Memory`, `memory(u8)` and
//! `ACCOUNT_REMOVAL_MEMORY` (three consecutive permanent ids starting there).
//! The authority (the identity coordinator) is governor-configured once and
//! immutable; the gate is inactive until then, and retained fences keep
//! denying subjects forever.
#![allow(dead_code)] // Hosts use different subsets of this shared gate.
use candid::{CandidType, Nat, Principal};
use ic_stable_structures::{StableBTreeMap, StableCell};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Request {
    pub account_id: String,
    pub generation: u64,
    pub inventory_digest: Vec<u8>,
    pub subjects: Vec<Principal>,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Receipt {
    pub request: Request,
    pub receiver: Principal,
    pub outstanding: Nat,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Configuration {
    pub receiver: Principal, pub authority: Option<Principal>, pub protocol: u32,
    pub admission_required: bool, pub removal_enabled: bool, pub rehearsal: bool,
}
pub fn configuration(caller:Principal,receiver:Principal)->Result<Configuration,String> {
    authorize(caller)?;
    Ok(Configuration {receiver,authority:authority(),protocol:1,admission_required:false,removal_enabled:true,rehearsal:false})
}

const MAX_INTENTS: u64 = 524_288;
const MAX_SUBJECTS: u64 = 4_194_304;

thread_local! {
    static AUTHORITY: RefCell<StableCell<Vec<u8>, crate::Memory>> =
        RefCell::new(StableCell::init(crate::memory(crate::ACCOUNT_REMOVAL_MEMORY), Vec::new()));
    static INTENTS: RefCell<StableBTreeMap<String, Vec<u8>, crate::Memory>> =
        RefCell::new(StableBTreeMap::init(crate::memory(crate::ACCOUNT_REMOVAL_MEMORY + 1)));
    static SUBJECTS: RefCell<StableBTreeMap<Vec<u8>, String, crate::Memory>> =
        RefCell::new(StableBTreeMap::init(crate::memory(crate::ACCOUNT_REMOVAL_MEMORY + 2)));
    // In-flight subject calls. Rust upgrades require a stopped canister, so
    // no awaited call survives an upgrade; a heap counter is exact.
    static ACTIVE: RefCell<BTreeMap<Principal, u64>> = const { RefCell::new(BTreeMap::new()) };
}

fn enc(r: &Request) -> Vec<u8> { let mut b = Vec::new(); ciborium::into_writer(r, &mut b).expect("removal encode"); b }
fn dec(b: &[u8]) -> Request { ciborium::from_reader(b).expect("removal decode") }

pub fn authority() -> Option<Principal> {
    AUTHORITY.with(|c| { let b = c.borrow().get().clone(); (!b.is_empty()).then(|| Principal::from_slice(&b)) })
}
/// Caller must already be verified as the governor by the host.
pub fn set_authority(p: Principal) -> Result<(), String> {
    if p == Principal::anonymous() || p == Principal::management_canister() { return Err("Invalid removal authority".into()); }
    match authority() {
        Some(existing) if existing == p => Ok(()),
        Some(_) => Err("Removal authority immutable".into()),
        None => { AUTHORITY.with(|c| c.borrow_mut().set(p.as_slice().to_vec())); Ok(()) }
    }
}
pub fn denied(subject: &Principal) -> bool { SUBJECTS.with(|m| m.borrow().contains_key(&subject.as_slice().to_vec())) }
pub fn intent(account_id: &str) -> Option<Request> { INTENTS.with(|m| m.borrow().get(&account_id.to_string())).map(|b| dec(&b)) }
pub fn fenced_subjects(account_id: &str) -> Vec<Principal> { intent(account_id).map(|r| r.subjects).unwrap_or_default() }

/// RAII in-flight hold for a subject; dropping it releases the hold.
pub struct Hold(Principal);
impl Drop for Hold {
    fn drop(&mut self) {
        ACTIVE.with(|m| { let mut m = m.borrow_mut();
            if let Some(n) = m.get_mut(&self.0) { if *n <= 1 { m.remove(&self.0); } else { *n -= 1; } } });
    }
}
/// Deny fenced subjects before any work; hold the subject until reply.
pub fn enter(subject: Principal) -> Result<Hold, String> {
    if denied(&subject) { return Err("Account removal fenced".into()); }
    ACTIVE.with(|m| { let mut m = m.borrow_mut();
        let n = m.get(&subject).copied().unwrap_or(0);
        if n >= 200 || (n == 0 && m.len() >= 100_000) { return Err("Account operation capacity reached".into()); }
        m.insert(subject, n + 1); Ok::<(), String>(()) })?;
    Ok(Hold(subject))
}
/// Re-check after every await: a fence installed mid-call wins.
pub fn recheck(subject: &Principal) -> Result<(), String> {
    if denied(subject) { Err("Account removal fenced after callback".into()) } else { Ok(()) }
}

fn authorize(caller: Principal) -> Result<(), String> {
    if caller == Principal::anonymous() || authority() != Some(caller) { return Err("Configured account removal authority required".into()); }
    Ok(())
}
pub fn prepare(caller: Principal, r: Request) -> Result<(), String> {
    authorize(caller)?;
    if r.account_id.is_empty() || r.account_id.len() > 128 || r.generation == 0 || r.inventory_digest.len() != 32
        || r.subjects.is_empty() || r.subjects.len() > 8 { return Err("Invalid removal fence".into()); }
    if let Some(prior) = intent(&r.account_id) {
        return if prior == r { Ok(()) } else { Err("Immutable removal fence conflict".into()) };
    }
    if INTENTS.with(|m| m.borrow().len()) >= MAX_INTENTS
        || SUBJECTS.with(|m| m.borrow().len()) + r.subjects.len() as u64 > MAX_SUBJECTS { return Err("Removal fence capacity reached".into()); }
    let mut unique = BTreeSet::new();
    for s in &r.subjects {
        if *s == Principal::anonymous() || *s == Principal::management_canister() || !unique.insert(*s) || denied(s) {
            return Err("Invalid or previously fenced subject".into());
        }
    }
    // Entire request validated before any persistent mutation. No awaits.
    INTENTS.with(|m| m.borrow_mut().insert(r.account_id.clone(), enc(&r)));
    SUBJECTS.with(|m| { let mut m = m.borrow_mut(); for s in &r.subjects { m.insert(s.as_slice().to_vec(), r.account_id.clone()); } });
    Ok(())
}
/// `retained` counts host obligations still bound to the subjects (for
/// example capabilities or openings) that the governor must settle first.
pub fn receipt(caller: Principal, r: Request, receiver: Principal, retained: u64) -> Result<Receipt, String> {
    authorize(caller)?;
    if intent(&r.account_id).as_ref() != Some(&r) { return Err("Exact persistent removal fence required".into()); }
    let active: u64 = ACTIVE.with(|m| { let m = m.borrow(); r.subjects.iter().map(|s| m.get(s).copied().unwrap_or(0)).sum() });
    Ok(Receipt { request: r, receiver, outstanding: Nat::from(active + retained) })
}
pub fn seal(caller: Principal, r: Request, receiver: Principal, retained: u64) -> Result<Receipt, String> {
    let receipt = receipt(caller, r, receiver, retained)?;
    if receipt.outstanding != Nat::from(0u8) { return Err("Removal work remains outstanding".into()); }
    Ok(receipt)
}

#[cfg(test)]
pub fn reset_for_tests() {
    AUTHORITY.with(|c| c.borrow_mut().set(Vec::new()));
    INTENTS.with(|m| { let keys: Vec<_> = m.borrow().iter().map(|e| e.key().clone()).collect(); for k in keys { m.borrow_mut().remove(&k); } });
    SUBJECTS.with(|m| { let keys: Vec<_> = m.borrow().iter().map(|e| e.key().clone()).collect(); for k in keys { m.borrow_mut().remove(&k); } });
    ACTIVE.with(|m| m.borrow_mut().clear());
}

#[cfg(test)]
mod tests {
    use super::*;
    fn p(n: u8) -> Principal { Principal::from_slice(&[n; 29]) }
    fn req(subjects: Vec<Principal>) -> Request { Request { account_id: "acct".into(), generation: 1, inventory_digest: vec![7; 32], subjects } }

    #[test] fn unconfigured_and_wrong_callers_are_refused() {
        reset_for_tests();
        assert!(prepare(p(1), req(vec![p(9)])).is_err());
        set_authority(p(1)).unwrap();
        assert!(set_authority(p(2)).is_err());
        assert!(prepare(p(2), req(vec![p(9)])).is_err());
        assert!(prepare(Principal::anonymous(), req(vec![p(9)])).is_err());
        assert!(!denied(&p(9)));
    }
    #[test] fn fence_is_immutable_denies_and_drains() {
        reset_for_tests(); set_authority(p(1)).unwrap();
        let hold = enter(p(9)).unwrap();
        prepare(p(1), req(vec![p(9), p(8)])).unwrap();
        prepare(p(1), req(vec![p(9), p(8)])).unwrap();
        assert!(prepare(p(1), req(vec![p(9)])).is_err());
        assert!(enter(p(9)).is_err() && enter(p(8)).is_err() && recheck(&p(9)).is_err());
        assert!(enter(p(7)).is_ok());
        assert_eq!(receipt(p(1), req(vec![p(9), p(8)]), p(3), 0).unwrap().outstanding, Nat::from(1u8));
        assert!(seal(p(1), req(vec![p(9), p(8)]), p(3), 0).is_err());
        drop(hold);
        assert!(seal(p(1), req(vec![p(9), p(8)]), p(3), 2).is_err());
        assert_eq!(seal(p(1), req(vec![p(9), p(8)]), p(3), 0).unwrap().receiver, p(3));
        assert!(seal(p(1), Request { generation: 2, ..req(vec![p(9), p(8)]) }, p(3), 0).is_err());
    }
    #[test] fn invalid_requests_write_nothing() {
        reset_for_tests(); set_authority(p(1)).unwrap();
        assert!(prepare(p(1), Request { inventory_digest: vec![1; 31], ..req(vec![p(9)]) }).is_err());
        assert!(prepare(p(1), req(vec![p(9), p(9)])).is_err());
        assert!(prepare(p(1), req(vec![p(9), Principal::anonymous()])).is_err());
        assert!(prepare(p(1), req(vec![])).is_err());
        assert!(!denied(&p(9)) && intent("acct").is_none());
    }
}
