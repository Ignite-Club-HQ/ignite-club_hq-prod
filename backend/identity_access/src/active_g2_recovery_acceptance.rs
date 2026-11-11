//! Proposed independent acceptance envelope for the ACTIVE DEV G2 reader.
//! This is a pure cryptographic preflight. A valid signature is *not* permission
//! to return an account: the live recovery witness, fenced subject history,
//! program/controller pins, and state-after-await verification remain required.
//! No call site is allowed to activate this draft without that implementation.
use candid::{CandidType, Principal};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use crate::active_g2_club_reader::{CLUB_ID, IDENTITY_ID, ROUTER_ID};

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Scope {
    pub identity: Principal,
    pub router: Principal,
    pub club_reader: Principal,
    pub witness: Principal,
    pub registry_revision: u64,
    pub generation: u64,
    pub recovery_epoch: u64,
    pub expires_at_ns: u64,
    pub accepted_recovery_digest: Vec<u8>,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct SignedScope {
    pub scope: Scope,
    pub signature: Vec<u8>,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct SubjectChallenge {
    pub scope_digest: Vec<u8>,
    pub nonce: u64,
    pub account_id: String,
    pub account_version: u64,
    pub principals: Vec<Principal>,
    pub subject: Principal,
    pub history_revision: u64,
    pub removal_generation: u64,
    pub recovery_epoch: u64,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct IndependentlyVerifiedSubject {
    pub challenge: SubjectChallenge,
    /// To be provided by a separately controlled and signed witness protocol.
    pub witness_revision: u64,
}

fn principal(id: &str) -> Result<Principal, String> {
    Principal::from_text(id).map_err(|_| "Invalid immutable Group 2 principal".into())
}
pub fn scope_signing_bytes(scope: &Scope) -> Result<Vec<u8>, String> {
    let encoded = candid::encode_one(scope).map_err(|_| "Invalid G2 scope encoding")?;
    if encoded.len() > 2048 { return Err("Oversized G2 scope".into()); }
    let mut out = b"ignite:dev-g2-club-reader:independent-acceptance:v1\0".to_vec();
    out.extend(Sha256::digest(encoded));
    Ok(out)
}
pub fn verify_independent_scope(
    signed: &SignedScope, key: &VerifyingKey, now_ns: u64,
    required_revision: u64, previous_generation: u64,
) -> Result<[u8; 32], String> {
    let s = &signed.scope;
    if s.identity != principal(IDENTITY_ID)? ||
        s.router != principal(ROUTER_ID)? ||
        s.club_reader != principal(CLUB_ID)? ||
        s.witness == s.identity || s.witness == s.club_reader ||
        s.witness == Principal::anonymous() || s.witness == Principal::management_canister() ||
        s.registry_revision != required_revision ||
        s.generation <= previous_generation || s.generation == 0 ||
        s.recovery_epoch == 0 ||
        s.expires_at_ns <= now_ns || s.expires_at_ns - now_ns > 24 * 60 * 60 * 1_000_000_000u64 ||
        s.accepted_recovery_digest.len() != 32 ||
        s.accepted_recovery_digest.iter().all(|b| *b == 0) {
        return Err("Exact live independently approved Group 2 scope required".into());
    }
    let signature = Signature::from_slice(&signed.signature).map_err(|_| "Independent G2 signature required")?;
    key.verify_strict(&scope_signing_bytes(s)?, &signature).map_err(|_| "Independent G2 signature required".into())?;
    let digest = Sha256::digest(scope_signing_bytes(s)?);
    Ok(digest.into())
}

/// This checks only the *shape* of the receipt against its challenge. It must
/// never be called instead of verifying the independent witness's live,
/// signed/fenced acceptance and current state. It is not an activation gate.
pub fn validate_subject_receipt(
    expected: &SubjectChallenge, reply: &IndependentlyVerifiedSubject,
) -> Result<(), String> {
    if reply.challenge != *expected ||
        expected.nonce == 0 ||
        expected.account_id.is_empty() || expected.account_id.len() > 128 ||
        expected.account_version == 0 ||
        expected.recovery_epoch == 0 ||
        expected.scope_digest.len() != 32 ||
        expected.principals.is_empty() || expected.principals.len() > 8 ||
        expected.principals.iter().any(|p| *p == Principal::anonymous()) ||
        !expected.principals.contains(&expected.subject) ||
        expected.principals.iter().copied().collect::<std::collections::BTreeSet<_>>().len() != expected.principals.len() {
        return Err("Exact fenced subject receipt required".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    fn p(n: u8) -> Principal { Principal::from_slice(&[n, 1]) }
    fn fixture() -> (SignedScope, VerifyingKey) {
        let s = Scope {identity:principal(IDENTITY_ID).unwrap(),router:principal(ROUTER_ID).unwrap(),
            club_reader:principal(CLUB_ID).unwrap(),witness:p(44),registry_revision:8,generation:1,
            recovery_epoch:3,expires_at_ns:3_600_000_000_100,accepted_recovery_digest:vec![1;32]};
        let signing = SigningKey::from_bytes(&[9;32]);
        let sig = signing.sign(&scope_signing_bytes(&s).unwrap()).to_bytes().to_vec();
        (SignedScope {scope:s,signature:sig},signing.verifying_key())
    }
    #[test]
    fn independent_cryptographic_scope_has_exact_domain_and_expiry() {
        let (s,k)=fixture();
        assert!(verify_independent_scope(&s,&k,100,8,0).is_ok());
        assert!(verify_independent_scope(&s,&k,100,9,0).is_err());
        assert!(verify_independent_scope(&s,&k,100,8,1).is_err());
        assert!(verify_independent_scope(&s,&k,s.scope.expires_at_ns,8,0).is_err());
        assert!(verify_independent_scope(&s,&SigningKey::from_bytes(&[5;32]).verifying_key(),100,8,0).is_err());
        assert!(verify_independent_scope(&SignedScope {signature:vec![0;64],..s.clone()},&k,100,8,0).is_err());
        for i in 0..7 {let mut bad=s.clone();match i {
            0=>bad.scope.identity=p(1),1=>bad.scope.club_reader=p(2),
            2=>bad.scope.router=p(3),3=>bad.scope.witness=bad.scope.identity,
            4=>bad.scope.recovery_epoch=0,5=>bad.scope.accepted_recovery_digest=vec![0;32],
            _=>bad.scope.generation=0,
        };assert!(verify_independent_scope(&bad,&k,100,8,0).is_err());}
    }
    fn challenge() -> SubjectChallenge {
        SubjectChallenge {scope_digest:vec![1;32],nonce:27,account_id:"account".into(),
            account_version:3,principals:vec![p(6),p(7)],subject:p(6),
            history_revision:13,removal_generation:7,recovery_epoch:3}
    }
    #[test]
    fn subject_receipt_rejects_other_principals_accounts_and_generations() {
        let q=challenge();
        let reply=IndependentlyVerifiedSubject {challenge:q.clone(),witness_revision:5};
        assert!(validate_subject_receipt(&q,&reply).is_ok());
        let mut other=q.clone();other.account_id="victim".into();
        assert!(validate_subject_receipt(&q,&IndependentlyVerifiedSubject{challenge:other,..reply.clone()}).is_err());
        let mut other=q.clone();other.removal_generation=0;
        assert!(validate_subject_receipt(&q,&IndependentlyVerifiedSubject{challenge:other,..reply.clone()}).is_err());
        let mut other=q.clone();other.subject=p(8);
        assert!(validate_subject_receipt(&other,&IndependentlyVerifiedSubject{challenge:other.clone(),..reply.clone()}).is_err());
        let mut dup=q.clone();dup.principals.push(p(6));
        assert!(validate_subject_receipt(&dup,&IndependentlyVerifiedSubject{challenge:dup.clone(),..reply.clone()}).is_err());
    }
}
