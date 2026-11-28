//! Install-only DEV commissioning. No signature, recovery receipt or reset path.
use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};
use crate::{group_inventory::Binding, production_account_protection::{Expectation, Lifecycle}};

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Receipt {
    pub expectation: Expectation,
    pub lifecycle: Vec<Lifecycle>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct State { pub initialized: bool, pub receipt: Option<Receipt> }

/// Immutable build input, not a mutable runtime switch. Fields use newline
/// separators: identity, governor, host, then the exact 31 backend principals.
#[derive(Clone, Debug)]
pub struct Pin { pub identity: Principal, pub governor: Principal, pub host: String, pub backends: Vec<Principal>, pub services: Vec<(String,Principal)> }
/// Normal code upgrades of a commissioned DEV identity keep the stored
/// first-install state untouched; they never reset, re-arm or recommission.
/// A non-DEV module over DEV state, a missing/foreign pin, or an uninitialized
/// state are refused so upgrades cannot become a reset path.
pub fn upgrade(build_pin:Option<&str>,state:&State,identity:Principal,governor:Principal)->Result<(),String>{
    upgrade_for(build_pin,state,identity,governor,"opencloud-dev")
}
/// Ordinary upgrades retain the additive engine receipt. A commissioned PROD
/// deployment never becomes fresh or pristine: its existing accounts are not
/// part of this receipt and are neither rewritten nor required to be empty.
pub fn upgrade_for(build_pin:Option<&str>,state:&State,identity:Principal,governor:Principal,deployment:&str)->Result<(),String>{
    if !state.initialized {
        return if build_pin.is_none() {Ok(())} else {Err("Engine admission upgrade requires initialized installation state".into())};
    }
    let pin=Pin::parse_for(build_pin.ok_or("Engine admission state requires the same immutable build")?,deployment)?;
    if pin.identity!=identity || pin.governor!=governor {return Err("Engine admission upgrade pins changed".into());}
    if let Some(r)=&state.receipt {pin.binding_for(&r.expectation.inventory.groups.binding,identity,governor,deployment)?;}
    Ok(())
}
impl Pin {
    pub fn parse(raw: &str) -> Result<Self, String> { Self::parse_for(raw,"opencloud-dev") }
    pub fn parse_for(raw: &str,deployment:&str) -> Result<Self, String> {
        if !crate::engine_scope::ENGINE_DEPLOYMENTS.contains(&deployment) {return Err("Exact OpenCloud deployment required".into());}
        let fields: Vec<_> = raw.lines().collect();
        if fields.len()!=34 { return Err("Exact 31 engine backend pins required".into()); }
        let p=|s:&str|->Result<Principal,String>{
            let p=Principal::from_text(s).map_err(|_|"Invalid DEV principal")?;
            if p==Principal::anonymous() || p==Principal::management_canister() || p.to_text()!=s {return Err("Invalid DEV principal".into());} Ok(p)
        };
        let services=fields[3..].iter().map(|s| {
            let (name,id)=s.split_once('=').ok_or("Named DEV backend pin required")?;
            Ok((name.to_string(),p(id)?))
        }).collect::<Result<Vec<_>,String>>()?;
        let mut backends=services.iter().map(|(_,p)|*p).collect::<Vec<_>>();
        backends.sort();
        if backends.windows(2).any(|w|w[0]==w[1]) {return Err("Distinct DEV backend pins required".into());}
        let result=Self {identity:p(fields[0])?, governor:p(fields[1])?,host:fields[2].into(),backends,services};
        if !result.backends.contains(&result.identity) || result.backends.contains(&result.governor) {return Err("DEV authority pin collision".into());}
        Ok(result)
    }
    pub fn binding(&self,b:&Binding,identity:Principal,governor:Principal)->Result<(),String>{
        self.binding_for(b,identity,governor,"opencloud-dev")
    }
    pub fn binding_for(&self,b:&Binding,identity:Principal,governor:Principal,deployment:&str)->Result<(),String>{
        if identity!=self.identity || governor!=self.governor || b.deployment_id!=deployment ||
            b.target_alias!=deployment || b.host!=self.host || !crate::engine_scope::engine_binding(b) || !self.backends.contains(&b.registry) {
            return Err("Exact immutable OpenCloud admission deployment required".into());
        } Ok(())
    }
    pub fn inventory(&self,expected:&Expectation)->Result<(),String>{
        let mut ids:Vec<_>=expected.modules.iter().map(|(p,_)|*p).collect();ids.sort();
        let required:Vec<_>=self.backends.iter().copied().filter(|p|!self.services.iter().any(|(n,id)|id==p && matches!(n.as_str(),"placement_registry"|"migration_coordinator"))).collect();
        if ids!=required {return Err("Complete pinned DEV authority modules required".into());}
        for group in &expected.inventory.groups.snapshot.groups {
            let prefix=match group.id.as_str(){"base"=>"g1","g2"=>"g2",_=>return Err("Exact base and g2 required".into())};
            for domain in &group.domains {
                let name=if domain.domain=="secret_workload_identity" {domain.domain.clone()} else {format!("{prefix}_{}",domain.domain)};
                if !self.services.contains(&(name,domain.canister)){return Err("DEV service role pin mismatch".into());}
            }
        }
        for row in &expected.inventory.supplemental {
            let name=if row.domain=="shard_router" {row.domain.clone()} else {
                let prefix=match row.group_id.as_str(){"base"=>"g1","g2"=>"g2",_=>return Err("Exact supplemental group required".into())};format!("{prefix}_{}",row.domain)
            };
            if !self.services.contains(&(name,row.canister)){return Err("DEV supplemental role pin mismatch".into());}
        }
        Ok(())
    }
}

/// Readback advances only the local history watermark; every authority,
/// module, role, group, store and deployment commitment must remain exact.
pub fn review_receipt(prior:&Receipt,requested:&Expectation,history:u64)->Result<(),String>{
    let mut current=prior.expectation.clone();
    current.inventory.groups.history_revision=history;
    if &current!=requested {return Err("OpenCloud receipt differs from current inventory".into());}
    Ok(())
}

pub fn first_install(total:u64, returned:usize, installs:usize, other_code_or_restore:bool)->Result<(),String>{
    if total==0 || total>100 || total!=returned as u64 || installs!=1 || other_code_or_restore {
        return Err("Fresh install history required; restore, reinstall or upgrade refused".into());
    } Ok(())
}
pub fn lifecycle(armed:&Lifecycle,live:&Lifecycle)->Result<(),String>{
    crate::recovery_lifecycle::check_armed(armed.changes,live.changes)?;
    if armed.canister!=live.canister || armed.module_hash!=live.module_hash {return Err("Fresh DEV module or identity changed".into());} Ok(())
}
pub fn retry(prior:&Receipt,requested:&Expectation)->Result<(),String>{
    if &prior.expectation!=requested {return Err("First-install commissioning already consumed; conflicting retry refused".into());} Ok(())
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn post_receipt_readback_only_advances_history_never_changes_inventory(){
        let (e,l,_)=crate::production_account_protection::tests::fixture();
        let r=Receipt{expectation:e.clone(),lifecycle:l};let mut requested=e;
        requested.inventory.groups.history_revision=9;
        review_receipt(&r,&requested,9).unwrap();
        assert_eq!(r.expectation.inventory.groups.history_revision,7);
        let mut bad=requested.clone();bad.modules[0].1[0]^=1;assert!(review_receipt(&r,&bad,9).is_err());
        let mut bad=requested.clone();bad.inventory.groups.binding.registry_revision+=1;assert!(review_receipt(&r,&bad,9).is_err());
        let mut bad=requested.clone();bad.inventory.media[0].registry.stores.clear();assert!(review_receipt(&r,&bad,9).is_err());
        let mut bad=requested;bad.inventory.groups.snapshot.groups[0].domains[0].canister=Principal::anonymous();assert!(review_receipt(&r,&bad,9).is_err());
    }
    #[test] fn fresh_install_is_not_restore_or_reset(){
        assert!(first_install(6,6,1,false).is_ok());
        assert!(first_install(6,6,1,true).is_err());
        assert!(first_install(6,6,2,false).is_err());
        assert!(first_install(101,100,1,false).is_err());
        assert!(first_install(6,5,1,false).is_err());
    }
    #[test] fn ordinary_updates_preserve_but_restores_and_upgrades_revoke(){
        let a=Lifecycle{canister:Principal::from_slice(&[1,1]),changes:6,module_hash:vec![3;32]};
        assert!(lifecycle(&a,&a).is_ok());
        for changes in [5,7] {let mut b=a.clone();b.changes=changes;assert!(lifecycle(&a,&b).is_err());}
        let mut b=a.clone();b.module_hash=vec![4;32];assert!(lifecycle(&a,&b).is_err());
    }
    #[test] fn dev_path_rejects_prod_and_mainnet(){
        let (_,mut b,_)=crate::group_inventory::tests::fixture();
        let p=Pin{identity:Principal::from_slice(&[99,1]),governor:Principal::from_slice(&[98,1]),host:"https://engine.example".into(),backends:vec![b.registry],services:vec![]};
        b.host=p.host.clone();b.network_kind="cloud_engine".into();b.target_alias="opencloud-dev".into();b.deployment_id="opencloud-dev".into();
        assert!(p.binding(&b,p.identity,p.governor).is_ok());
        for env in ["opencloud-prod","mainnet","prod"] {b.target_alias=env.into();b.deployment_id=env.into();assert!(p.binding(&b,p.identity,p.governor).is_err());}
        b.target_alias="opencloud-dev".into();b.deployment_id="opencloud-dev".into();assert!(p.binding(&b,p.identity,Principal::anonymous()).is_err());
    }
    #[test] fn prod_admission_pin_never_crosses_dev_or_mainnet(){
        let (_,mut b,_)=crate::group_inventory::tests::fixture();
        let p=Pin{identity:Principal::from_slice(&[97,1]),governor:Principal::from_slice(&[96,1]),host:"https://engine.example".into(),backends:vec![b.registry],services:vec![]};
        b.host=p.host.clone();b.network_kind="cloud_engine".into();b.target_alias="opencloud-prod".into();b.deployment_id="opencloud-prod".into();
        assert!(p.binding_for(&b,p.identity,p.governor,"opencloud-prod").is_ok());
        assert!(p.binding(&b,p.identity,p.governor).is_err());
        b.target_alias="mainnet".into();b.deployment_id="prod".into();b.host="https://icp-api.io".into();b.network_kind="public_mainnet".into();
        assert!(p.binding_for(&b,p.identity,p.governor,"opencloud-prod").is_err());
    }
    #[test] fn consumed_commissioning_refuses_different_inventory(){
        let (e,l,_)=crate::production_account_protection::tests::fixture();
        let receipt=Receipt{expectation:e.clone(),lifecycle:l};assert!(retry(&receipt,&e).is_ok());
        let mut changed=e;changed.inventory.groups.binding.registry_revision+=1;assert!(retry(&receipt,&changed).is_err());
    }
    #[test] fn upgrades_preserve_commissioning_and_never_reset(){
        let id=|n:u8|Principal::from_slice(&[n,7,7]);
        let mut lines=vec![id(1).to_text(),id(200).to_text(),"https://engine.example".to_string()];
        for n in 1..=31u8 {lines.push(format!("svc{n}={}",id(n).to_text()));}
        let raw=lines.join("\n");
        let (e,l,_)=crate::production_account_protection::tests::fixture();
        let fresh=State{initialized:true,receipt:None};
        // Ordinary upgrade of the same DEV build keeps state (installed, not yet commissioned).
        assert!(upgrade(Some(&raw),&fresh,id(1),id(200)).is_ok());
        // Mainnet/PROD builds keep upgrading normally when no DEV state exists.
        assert!(upgrade(None,&State::default(),id(1),id(200)).is_ok());
        // A non-DEV module over DEV state, an uninitialized DEV state, or changed pins are refused.
        assert!(upgrade(None,&fresh,id(1),id(200)).is_err());
        assert!(upgrade(Some(&raw),&State::default(),id(1),id(200)).is_err());
        assert!(upgrade(Some(&raw),&fresh,id(2),id(200)).is_err());
        assert!(upgrade(Some(&raw),&fresh,id(1),id(201)).is_err());
        // A commissioned receipt bound to another deployment is refused.
        let foreign=State{initialized:true,receipt:Some(Receipt{expectation:e,lifecycle:l})};
        assert!(upgrade(Some(&raw),&foreign,id(1),id(200)).is_err());
    }
}
