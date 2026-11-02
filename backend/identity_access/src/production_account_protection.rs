//! Exact production authorization review. A verified draft is not a grant:
//! activation requires independently accepted recovery and runtime evidence.
use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use crate::group_inventory::{self, RemovalInventory};

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Expectation {
    pub inventory: RemovalInventory,
    pub identity: Principal,
    pub modules: Vec<(Principal, Vec<u8>)>,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Lifecycle {
    pub canister: Principal,
    pub changes: u64,
    pub module_hash: Vec<u8>,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReceiverConfiguration {
    pub receiver: Principal,
    pub authority: Option<Principal>,
    pub protocol: u32,
    pub admission_required: bool,
    pub removal_enabled: bool,
    pub rehearsal: bool,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Draft {
    pub inventory: RemovalInventory,
    pub eligibility_readers: Vec<Principal>,
    pub account_readers: Vec<Principal>,
    pub targets: Vec<Principal>,
    pub lifecycle: Vec<Lifecycle>,
    pub configurations: Vec<ReceiverConfiguration>,
    pub release_authorized: bool,
    pub recovery_accepted: bool,
}
const HUMAN: [&str; 11] = ["club_domain", "events_domain", "messaging_domain", "vault_domain",
    "competition_domain", "club_points_domain", "mini_league_domain", "media_metadata",
    "insights_domain", "notification_queue", "pii_access_control"];
fn valid(p: Principal) -> bool { p != Principal::anonymous() && p != Principal::management_canister() }

pub fn scope(expected: &Expectation) -> Result<(Vec<Principal>, Vec<Principal>), String> {
    let i=&expected.inventory; let b=&i.groups.binding;
    if !valid(expected.identity) || b.target_alias != "mainnet" || b.deployment_id != "prod" ||
        b.host != "https://icp-api.io" || b.network_kind != "public_mainnet" {
        return Err("Exact PROD account protection binding required".into());
    }
    let clubs: Vec<_>=i.groups.snapshot.groups.iter().flat_map(|g|g.domains.iter())
        .filter(|d|d.domain=="club_domain").map(|d|d.canister).collect();
    let mut readers: BTreeSet<_>=i.groups.snapshot.groups.iter().flat_map(|g|g.domains.iter())
        .filter(|d|HUMAN.contains(&d.domain.as_str())).map(|d|d.canister).collect();
    readers.extend(i.media.iter().flat_map(|m|m.registry.stores.iter().copied()));
    let readers:Vec<_>=readers.into_iter().collect();
    crate::expected_removal_inventory::validate_exact(&crate::expected_removal_inventory::ExpectedInventory {
        inventory:i.clone(),clubs,readers:readers.clone() }, i)?;
    // Every supplemental authority is classified; none can acquire alias reads
    // just because it participates in draining. Multiple media stores are allowed.
    if i.supplemental.iter().any(|s|!matches!(s.domain.as_str(),"media_blob_store"|"shard_router")) ||
        i.supplemental.iter().filter(|s|s.domain=="shard_router").count()!=1 ||
        !i.supplemental.iter().any(|s|s.domain=="shard_router" && s.canister==b.registry) {
        return Err("Exact original router and classified supplemental inventory required".into());
    }
    let mut targets:BTreeSet<_>=i.groups.snapshot.groups.iter().flat_map(|g|g.domains.iter().map(|d|d.canister)).collect();
    targets.extend(i.supplemental.iter().map(|s|s.canister));
    if targets.contains(&expected.identity) { return Err("Identity collides with a receiver".into()); }
    let mut modules=BTreeMap::new();
    for (p,h) in &expected.modules {
        if !valid(*p) || h.len()!=32 || modules.insert(*p,h).is_some() { return Err("Distinct exact module inventory required".into()); }
    }
    let mut required=targets.clone();required.insert(expected.identity);
    if modules.keys().copied().collect::<BTreeSet<_>>()!=required { return Err("Complete receiver and identity modules required".into()); }
    Ok((readers,targets.into_iter().collect()))
}

pub fn verify(expected:&Expectation, observed:&RemovalInventory, before:&[Lifecycle], after:&[Lifecycle],
    configurations:&[ReceiverConfiguration]) -> Result<Draft,String> {
    let (readers,targets)=scope(expected)?;
    let clubs=expected.inventory.media.iter().map(|m|m.club_authority).collect();
    crate::expected_removal_inventory::validate_exact(&crate::expected_removal_inventory::ExpectedInventory {
        inventory:expected.inventory.clone(),clubs,readers:readers.clone() },observed)?;
    let normalize=|items:&[Lifecycle]| -> Result<BTreeMap<Principal,Lifecycle>,String> {
        let mut map=BTreeMap::new();for row in items {
            if map.insert(row.canister,row.clone()).is_some() { return Err("Duplicate lifecycle evidence".into()); }
        } Ok(map)
    };
    let first=normalize(before)?;let last=normalize(after)?;
    if first!=last || first.len()!=expected.modules.len() { return Err("Lifecycle changed or incomplete".into()); }
    for (canister,hash) in &expected.modules {
        if first.get(canister).is_none_or(|r|&r.module_hash!=hash) { return Err("Live module differs from reviewed module".into()); }
    }
    let mut configs=BTreeMap::new();
    for row in configurations {
        if configs.insert(row.receiver,row.clone()).is_some() || row.authority!=Some(expected.identity) || row.protocol!=1 ||
            row.rehearsal || !row.removal_enabled || (readers.contains(&row.receiver) && !row.admission_required) {
            return Err("Production receiver protection incomplete".into());
        }
    }
    if configs.keys().copied().collect::<BTreeSet<_>>()!=targets.iter().copied().collect() {
        return Err("Complete authenticated receiver configurations required".into());
    }
    Ok(Draft { inventory:observed.clone(), eligibility_readers:readers.clone(),account_readers:readers,
        targets,lifecycle:last.into_values().collect(),configurations:configs.into_values().collect(),
        release_authorized:false,recovery_accepted:false })
}

#[cfg(test)] mod tests {
    use super::*;
    fn fixture()->(Expectation,Vec<Lifecycle>,Vec<ReceiverConfiguration>) {
        let (mut snapshot,mut binding,clubs)=group_inventory::tests::fixture();
        binding.target_alias="mainnet".into();binding.deployment_id="prod".into();binding.host="https://icp-api.io".into();
        for (n,g) in snapshot.groups.iter_mut().enumerate(){g.id=if n==0{"base"}else{"g2"}.into();g.target_alias=binding.target_alias.clone();}
        for (n,p) in snapshot.placements.iter_mut().enumerate(){p.group_id=snapshot.groups[n].id.clone();p.deployment_id=binding.deployment_id.clone();p.host=binding.host.clone();}
        let p=|n|Principal::from_slice(&[n,1]);
        let inventory=RemovalInventory { groups:group_inventory::Evidence {snapshot,binding:binding.clone(),history_revision:7},
            supplemental:vec![group_inventory::Supplemental {group_id:"base".into(),domain:"media_blob_store".into(),canister:p(91),subnet:p(80)},
                group_inventory::Supplemental {group_id:"g2".into(),domain:"media_blob_store".into(),canister:p(92),subnet:p(80)},
                group_inventory::Supplemental {group_id:"base".into(),domain:"shard_router".into(),canister:binding.registry,subnet:p(80)}],
            media:clubs.iter().enumerate().map(|(n,c)|group_inventory::MediaEvidence {club_authority:*c,
                registry:group_inventory::MediaRegistry {active:false,stores:vec![p(91+n as u8)]}}).collect() };
        let mut targets:BTreeSet<_>=inventory.groups.snapshot.groups.iter().flat_map(|g|g.domains.iter().map(|d|d.canister)).collect();
        targets.extend(inventory.supplemental.iter().map(|s|s.canister));let identity=p(99);
        let configs=targets.iter().map(|receiver|ReceiverConfiguration {receiver:*receiver,authority:Some(identity),protocol:1,
            admission_required:true,removal_enabled:true,rehearsal:false}).collect();
        targets.insert(identity);let modules=targets.iter().map(|p|(*p,vec![7;32])).collect();
        let lifecycle=targets.iter().map(|p|Lifecycle {canister:*p,changes:4,module_hash:vec![7;32]}).collect();
        (Expectation {inventory,identity,modules},lifecycle,configs)
    }
    #[test] fn exact_base_g2_review_never_grants_release_or_infrastructure_aliases(){
        let (e,l,c)=fixture();let d=verify(&e,&e.inventory,&l,&l,&c).unwrap();
        assert_eq!(d.targets.len(),28);assert_eq!(d.account_readers.len(),24);
        assert!(!d.release_authorized && !d.recovery_accepted);
        assert!(!d.account_readers.contains(&e.inventory.groups.binding.registry));
    }
    #[test] fn any_receiver_missing_wrong_authority_or_rehearsal_is_refused(){
        let(e,l,c)=fixture();for at in 0..c.len(){let mut bad=c.clone();bad.remove(at);assert!(verify(&e,&e.inventory,&l,&l,&bad).is_err());
            let mut bad=c.clone();bad[at].rehearsal=true;assert!(verify(&e,&e.inventory,&l,&l,&bad).is_err());
            let mut bad=c.clone();bad[at].authority=None;assert!(verify(&e,&e.inventory,&l,&l,&bad).is_err());}
    }
    #[test] fn lifecycle_rollback_module_drift_and_omitted_router_fail(){
        let(e,l,c)=fixture();let mut changed=l.clone();changed[0].changes-=1;assert!(verify(&e,&e.inventory,&l,&changed,&c).is_err());
        let mut changed=l.clone();changed[0].module_hash[0]=9;assert!(verify(&e,&e.inventory,&changed,&changed,&c).is_err());
        let mut observed=e.inventory.clone();observed.supplemental.pop();assert!(verify(&e,&observed,&l,&l,&c).is_err());
    }
    #[test] fn foreign_binding_duplicate_modules_and_eligibility_only_refused(){
        let(e,l,c)=fixture();let mut bad=e.clone();bad.inventory.groups.binding.deployment_id="mainnet".into();assert!(scope(&bad).is_err());
        let mut bad=e.clone();bad.modules.push(bad.modules[0].clone());assert!(scope(&bad).is_err());
        let mut c=c; c[0].removal_enabled=false;assert!(verify(&e,&e.inventory,&l,&l,&c).is_err());
    }
}