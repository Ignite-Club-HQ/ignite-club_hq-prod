//! Stable runtime configuration is separate from admission/lifecycle grants.
//! No reader/cutover flag exists until complete coverage/freshness is proven.
use candid::{CandidType,Principal};
use serde::{Serialize,Deserialize};
use std::collections::BTreeMap;
use crate::{group_inventory, membership_transport::SourceBinding};
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
pub struct Config {
    pub binding:group_inventory::Binding, pub generation:u64,
    pub inventory_digest:Vec<u8>, pub sources:Vec<(String,Principal)>,
    pub pending:BTreeMap<String,u64>, pub enabled:bool,
    #[serde(default)] pub next_source:usize,
    #[serde(default)] pub lifecycle:Vec<crate::membership_acceptance::Lifecycle>,
    #[serde(default)] pub release:Option<String>,
}
impl Config {
    pub fn same_configuration(&self,other:&Self)->bool {
        self.binding==other.binding&&self.generation==other.generation&&self.inventory_digest==other.inventory_digest&&self.sources==other.sources&&self.enabled==other.enabled&&self.lifecycle==other.lifecycle&&self.release==other.release
    }
    pub fn check_watermark(&self,source:&str,revision:u64)->Result<(),String> {
        if self.pending.get(source).copied().unwrap_or(0)>revision{return Err("Source status superseded by invalidation".into());}Ok(())
    }
    pub fn source_binding(&self,identity:Principal,source:&str)->Result<SourceBinding,String> {
        if !self.enabled || !self.sources.iter().any(|(id,_)|id==source) { return Err("Directory source unconfigured".into()); }
        Ok(SourceBinding{identity,router:self.binding.registry,group:source.into(),deployment:self.binding.target_alias.clone(),generation:self.generation,inventory_digest:self.inventory_digest.clone()})
    }
    pub fn invalidate(&mut self,identity:Principal,caller:Principal,binding:&SourceBinding,revision:u64)->Result<(),String> {
        if revision==0 || &self.source_binding(identity,&binding.group)?!=binding ||
            !self.sources.iter().any(|(id,p)|id==&binding.group&&*p==caller) { return Err("Exact directory source authority required".into()); }
        let prior=self.pending.get(&binding.group).copied().unwrap_or(0);
        // Old/repeated notifications are harmless; never lower the watermark.
        if revision>prior { self.pending.insert(binding.group.clone(),revision); } Ok(())
    }
}
#[derive(Clone,Debug,CandidType,Deserialize)]
pub struct Progress { pub source:String, pub phase:String, pub revision:u64, pub scanned:u64 }
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn only_exact_writer_can_raise_durable_watermark() {
        let (_,binding,a)=group_inventory::tests::fixture();let identity=Principal::from_slice(&[99,1]);
        let mut c=Config{binding,generation:1,inventory_digest:vec![1;32],sources:vec![("g0".into(),a[0])],pending:BTreeMap::new(),enabled:true,next_source:0,lifecycle:vec![],release:None};
        let b=c.source_binding(identity,"g0").unwrap();
        assert!(c.invalidate(identity,a[1],&b,10).is_err());assert!(c.pending.is_empty());
        c.invalidate(identity,a[0],&b,10).unwrap();c.invalidate(identity,a[0],&b,1).unwrap();assert_eq!(c.pending["g0"],10);
        assert!(c.check_watermark("g0",9).is_err());assert!(c.check_watermark("g0",10).is_ok());
        let mut progress=c.clone();progress.pending.insert("g0".into(),11);assert!(c.same_configuration(&progress));
        let mut foreign=b.clone();foreign.generation=2;assert!(c.invalidate(identity,a[0],&foreign,20).is_err());
        assert_eq!(c.pending["g0"],10);c.enabled=false;assert!(c.invalidate(identity,a[0],&b,20).is_err());
    }
}
/** One specific disposable DEV setup. This check MUST NOT be repurposed into
 * a general reset endpoint: the DEV account/PII service is a shared canister.
 */
pub const DEV_RESET_CONFIRMATION:&str="RESET IGNITE DEV DIRECTORY 7 TO 11";
/// Unlike an unreleased disposable directory, this explicitly acknowledges
/// that existing DEV lookup consumers will lose their old directory session.
pub const DEV_RELEASED_RESET_CONFIRMATION:&str="RESET RELEASED IGNITE DEV DIRECTORY 7 TO 11";
pub fn require_exact_dev_disposable_reset(
    current_canister:Principal,
    caller:Principal,
    governor:Principal,
    config:&Config,
    saved_revision:u64,
    live_revision:u64,
    confirmation:&str,
)->Result<(),String>{
    let principal=|s|Principal::from_text(s).map_err(|_|"Invalid pinned DEV canister");
    let dev_identity=principal("mq2sj-fiaaa-aaaal-qxlqa-cai")?;
    let router=principal("jcdfe-vqaaa-aaaal-qxloq-cai")?;
    let original_club=principal("mzzzv-taaaa-aaaal-qxlrq-cai")?;
    let group2_club=principal("yfwyv-nyaaa-aaaal-qxpyq-cai")?;
    if current_canister!=dev_identity || caller!=governor {
        return Err("Only the exact DEV Identity canister and governor may reset test directory data".into());
    }
    if saved_revision!=7 || live_revision!=11 {
        return Err("Exact 7-to-11 disposable DEV reset revision required".into());
    }
    // A released directory is not the same operation as an unreleased
    // rehearsal. Require a stronger, separately approved acknowledgement.
    match config.release.as_deref() {
        None if confirmation==DEV_RESET_CONFIRMATION => {},
        Some(release) if confirmation==DEV_RELEASED_RESET_CONFIRMATION
            && release.len()==40 && release.bytes().all(|c|
                c.is_ascii_digit() || (b'a'..=b'f').contains(&c)) => {},
        _ => return Err("Exact released/unreleased DEV directory reset acknowledgement required".into()),
    }
    let binding=&config.binding;
    if binding.registry!=router || binding.registry_revision!=saved_revision ||
        binding.target_alias!="mainnet" || binding.deployment_id!="mainnet" ||
        binding.deployment_revision!=1 || binding.host!="https://icp-api.io" ||
        binding.network_kind!="public_mainnet" ||
        config.generation!=1 ||
        config.sources!=vec![("g1".into(),original_club),("g2".into(),group2_club)] ||
        config.inventory_digest.len()!=32 {
        return Err("Identity directory does not match exact disposable DEV source inventory".into());
    }
    if !config.enabled {
        return Err("Disabled Identity directory cannot use this disposable DEV reset path".into());
    }
    Ok(())
}

#[cfg(test)]
mod disposable_dev_reset_tests {
    use super::*;
    fn p(n:u8)->Principal{Principal::from_slice(&[n,1])}
    fn fixture()->Config {
        Config{
            binding:group_inventory::Binding {
                registry:Principal::from_text("jcdfe-vqaaa-aaaal-qxloq-cai").unwrap(),
                registry_revision:7,
                target_alias:"mainnet".into(),
                deployment_id:"mainnet".into(),deployment_revision:1,
                host:"https://icp-api.io".into(),network_kind:"public_mainnet".into(),
            },
            generation:1,inventory_digest:vec![1;32],
            sources:vec![
                ("g1".into(),Principal::from_text("mzzzv-taaaa-aaaal-qxlrq-cai").unwrap()),
                ("g2".into(),Principal::from_text("yfwyv-nyaaa-aaaal-qxpyq-cai").unwrap()),
            ],
            pending:Default::default(),enabled:true,next_source:0,
            lifecycle:vec![],release:None,
        }
    }
    fn identity()->Principal{Principal::from_text("mq2sj-fiaaa-aaaal-qxlqa-cai").unwrap()}
    #[test]fn exact_dev_test_configuration_only(){
        let who=p(3);
        assert!(require_exact_dev_disposable_reset(identity(),who,who,&fixture(),7,11,DEV_RESET_CONFIRMATION).is_ok());
        assert!(require_exact_dev_disposable_reset(identity(),who,who,&fixture(),7,10,DEV_RESET_CONFIRMATION).is_err());
        assert!(require_exact_dev_disposable_reset(identity(),who,who,&fixture(),8,11,DEV_RESET_CONFIRMATION).is_err());
        assert!(require_exact_dev_disposable_reset(identity(),who,p(4),&fixture(),7,11,DEV_RESET_CONFIRMATION).is_err());
        assert!(require_exact_dev_disposable_reset(p(5),who,who,&fixture(),7,11,DEV_RESET_CONFIRMATION).is_err());
        assert!(require_exact_dev_disposable_reset(identity(),who,who,&fixture(),7,11,"I agree").is_err());
    }
    #[test]fn exact_released_dev_test_directory_requires_distinct_acknowledgement(){
        let who=p(3);
        let mut c=fixture();
        c.release=Some("a".repeat(40));
        assert!(require_exact_dev_disposable_reset(identity(),who,who,&c,7,11,DEV_RELEASED_RESET_CONFIRMATION).is_ok());
        assert!(require_exact_dev_disposable_reset(identity(),who,who,&c,7,11,DEV_RESET_CONFIRMATION).is_err());
        assert!(require_exact_dev_disposable_reset(identity(),who,who,&c,8,11,DEV_RELEASED_RESET_CONFIRMATION).is_err());
        assert!(require_exact_dev_disposable_reset(identity(),who,p(4),&c,7,11,DEV_RELEASED_RESET_CONFIRMATION).is_err());
        assert!(require_exact_dev_disposable_reset(p(5),who,who,&c,7,11,DEV_RELEASED_RESET_CONFIRMATION).is_err());
        c.enabled=false;
        assert!(require_exact_dev_disposable_reset(identity(),who,who,&c,7,11,DEV_RELEASED_RESET_CONFIRMATION).is_err());
        c.enabled=true;c.release=None;
        assert!(require_exact_dev_disposable_reset(identity(),who,who,&c,7,11,DEV_RELEASED_RESET_CONFIRMATION).is_err());
        for invalid in ["test".into(),"A".repeat(40),"z".repeat(40),"a".repeat(39)] {
            c.release=Some(invalid);
            assert!(require_exact_dev_disposable_reset(identity(),who,who,&c,7,11,DEV_RELEASED_RESET_CONFIRMATION).is_err());
        }
    }
    #[test]fn cannot_reset_released_or_foreign_sources(){
        let who=p(3);let mut c=fixture();c.release=Some("test".into());
        assert!(require_exact_dev_disposable_reset(identity(),who,who,&c,7,11,DEV_RESET_CONFIRMATION).is_err());
        c.release=None;c.sources[0].1=p(10);
        assert!(require_exact_dev_disposable_reset(identity(),who,who,&c,7,11,DEV_RESET_CONFIRMATION).is_err());
        c=fixture();c.generation=2;
        assert!(require_exact_dev_disposable_reset(identity(),who,who,&c,7,11,DEV_RESET_CONFIRMATION).is_err());
    }
}
