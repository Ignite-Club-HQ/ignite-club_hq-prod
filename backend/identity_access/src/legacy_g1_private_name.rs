//! Original DEV Group-1 private name **origin** guard, not a name/read grant.
 //! Group 1 is an original Identity-owned directory source; no modern router
 //! placement exists for its PII canister. Only team audience requests using
 //! the exact original DEV PII may take this explicitly disabled-by-default path.
 //! DEV disposable test data may use the owner-verified public-key observation
 //! as its release pin. This is key-identity continuity, NOT historical provenance.
use candid::Principal;
use sha2::{Digest,Sha256};
use crate::{group_inventory, membership_runtime, private_name_audience};

pub const RELEASE_SWITCH:&str="IGNITE_DEV_LEGACY_G1_TEAM_NAME_RELEASE";
pub const APPROVED_KEY_SHA256:&str="IGNITE_DEV_LEGACY_G1_OBSERVED_KEY_SHA256";
/// Owner-verified original PII public-key SHA-256 from DEV authority checks
/// 43785400907 and 43787337237 (16 November 2026). No historical claim.
pub const VERIFIED_DEV_PUBLIC_KEY_SHA256:&str="f80ed20bc0d8a244f40b31fdbd0024ff469d24254197dce9242dce669fa1f34d";

fn pinned(id:&str)->Result<Principal,String>{
    Principal::from_text(id).map_err(|_|"Invalid exact DEV private-name authority".into())
}
fn good_sha256(s:&str)->bool{s.len()==64 && s.bytes().all(|c|c.is_ascii_digit()||(b'a'..=b'f').contains(&c))}
/// The exact original DEV service is a static, release-gated source entry.
pub fn exact_original_dev_pii_caller(self_id:Principal, service:Principal)->bool {
    self_id==pinned("mq2sj-fiaaa-aaaal-qxlqa-cai").unwrap()
        && service==pinned("iui5p-aaaaa-aaaal-qxllq-cai").unwrap()
}


pub fn require_exact_origin(
    self_id:Principal,
    pii_caller:Principal,
    scope:&private_name_audience::Scope,
    config:&membership_runtime::Config,
    router:&group_inventory::Snapshot,
    service_allowlist:&[Principal],
    approved_release:bool,
    approved_observed_sha256:Option<&str>,
)->Result<String,String>{
    // No caller, browser, email or PROD-supplied pin may relax this scope.
    let identity=pinned("mq2sj-fiaaa-aaaal-qxlqa-cai")?;
    let original_pii=pinned("iui5p-aaaaa-aaaal-qxllq-cai")?;
    let original_club=pinned("mzzzv-taaaa-aaaal-qxlrq-cai")?;
    let group2_club=pinned("yfwyv-nyaaa-aaaal-qxpyq-cai")?;
    let group2_pii=pinned("zt5a6-yiaaa-aaaal-qxp5q-cai")?;
    let router_id=pinned("jcdfe-vqaaa-aaaal-qxloq-cai")?;
    if !approved_release || self_id!=identity || pii_caller!=original_pii ||
        scope.kind!="team" || scope.authority!=group2_club ||
        !service_allowlist.contains(&pii_caller) {
        return Err("Exact DEV original PII, release, service and team audience required".into());
    }
    if !config.enabled || config.release.is_none() || config.generation!=2 ||
        config.binding.registry!=router_id || config.binding.registry_revision!=11 ||
        config.binding.target_alias!="mainnet" || config.binding.deployment_id!="mainnet" ||
        config.binding.deployment_revision!=1 || config.binding.host!="https://icp-api.io" ||
        config.binding.network_kind!="public_mainnet" ||
        config.inventory_digest.len()!=32 ||
        config.sources != vec![("g1".into(),original_club),("g2".into(),group2_club)] {
        return Err("Released generation-2 DEV directory or original source changed".into());
    }
    // The router is the authority for only modern G2; never synthesise a
    // registered G1 placement from a browser profile reference.
    if router.revision!=11 || router.groups.len()!=1 || router.placements.len()!=1 ||
        router.groups[0].id!="g2" || router.placements[0].group_id!="g2" ||
        router.groups[0].domains.iter().find(|d|d.domain=="club_domain").map(|d|d.canister)!=Some(group2_club) ||
        router.groups[0].domains.iter().find(|d|d.domain=="pii_access_control").map(|d|d.canister)!=Some(group2_pii) ||
        router.groups.iter().flat_map(|g|&g.domains).any(|d|d.canister==original_pii) {
        return Err("Registered G2 or original legacy PII inventory changed".into());
    }
    let observed_sha256=approved_observed_sha256
        .filter(|hash|good_sha256(hash) && *hash==VERIFIED_DEV_PUBLIC_KEY_SHA256)
        .ok_or("Exact independently read DEV original PII public-key pin required")?;
    Ok(observed_sha256.into())
}

pub fn verify_current_public_key(key:&[u8],historical_sha256:&str)->Result<(),String>{
    if key.len()!=96 || !good_sha256(historical_sha256) ||
        format!("{:x}",Sha256::digest(key))!=historical_sha256 {
        return Err("Original DEV PII public key differs from independently approved key".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests{
    use super::*;
    use std::collections::BTreeMap;
    fn p(s:&str)->Principal{pinned(s).unwrap()}
    fn config()->membership_runtime::Config{
        membership_runtime::Config{
            binding:group_inventory::Binding{
                registry:p("jcdfe-vqaaa-aaaal-qxloq-cai"),registry_revision:11,target_alias:"mainnet".into(),
                deployment_id:"mainnet".into(),deployment_revision:1,host:"https://icp-api.io".into(),
                network_kind:"public_mainnet".into()
            },
            generation:2,inventory_digest:vec![7;32],
            sources:vec![
                ("g1".into(),p("mzzzv-taaaa-aaaal-qxlrq-cai")),
                ("g2".into(),p("yfwyv-nyaaa-aaaal-qxpyq-cai"))],
            pending:BTreeMap::new(),enabled:true,next_source:0,lifecycle:vec![],
            release:Some("a".repeat(40))
        }
    }
    fn router()->group_inventory::Snapshot{
        let club=p("yfwyv-nyaaa-aaaal-qxpyq-cai");
        let pii=p("zt5a6-yiaaa-aaaal-qxp5q-cai");
        group_inventory::Snapshot{
            revision:11,
            groups:vec![group_inventory::Group{id:"g2".into(),target_alias:"mainnet".into(),
                domains:vec![
                    group_inventory::Domain{domain:"club_domain".into(),canister:club},
                    group_inventory::Domain{domain:"pii_access_control".into(),canister:pii}]}],
            placements:vec![group_inventory::Placement{group_id:"g2".into(),
                deployment_id:"mainnet".into(),deployment_revision:1,
                host:"https://icp-api.io".into(),network_kind:"public_mainnet".into(),
                primary_subnet:p("mq2sj-fiaaa-aaaal-qxlqa-cai"),
                approved_subnets:vec![p("mq2sj-fiaaa-aaaal-qxlqa-cai")],
                additional_subnets_enabled:false,domains:vec![]}]
        }
    }
    fn scope()->private_name_audience::Scope{
        private_name_audience::Scope{kind:"team".into(),
            authority:p("yfwyv-nyaaa-aaaal-qxpyq-cai"),
            resource:"u10".into(),profile_revision:7}
    }
    fn verify(c:&membership_runtime::Config,r:&group_inventory::Snapshot,
        caller:Principal,s:&private_name_audience::Scope,allow:&[Principal],released:bool,key:Option<&str>)
        ->Result<String,String>{
        require_exact_origin(p("mq2sj-fiaaa-aaaal-qxlqa-cai"),caller,s,c,r,allow,released,key)
    }
    #[test]fn exact_original_pii_and_g2_team_only_with_verified_observed_key(){
        let caller=p("iui5p-aaaaa-aaaal-qxllq-cai");
        let key=VERIFIED_DEV_PUBLIC_KEY_SHA256.to_string();
        assert_eq!(verify(&config(),&router(),caller,&scope(),&[caller],true,Some(&key)),Ok(key));
    }
    #[test]fn foreign_service_browser_and_other_scope_fail_closed(){
        let caller=p("iui5p-aaaaa-aaaal-qxllq-cai");
        let key=VERIFIED_DEV_PUBLIC_KEY_SHA256.to_string();
        assert!(verify(&config(),&router(),p("zt5a6-yiaaa-aaaal-qxp5q-cai"),&scope(),&[caller],true,Some(&key)).is_err());
        assert!(verify(&config(),&router(),caller,&scope(),&[],true,Some(&key)).is_err());
        assert!(verify(&config(),&router(),caller,&scope(),&[caller],false,Some(&key)).is_err());
        assert!(verify(&config(),&router(),caller,&scope(),&[caller],true,None).is_err());
        let mut wrong=scope();wrong.kind="club".into();
        assert!(verify(&config(),&router(),caller,&wrong,&[caller],true,Some(&key)).is_err());
        wrong.kind="team".into();wrong.authority=p("mzzzv-taaaa-aaaal-qxlrq-cai");
        assert!(verify(&config(),&router(),caller,&wrong,&[caller],true,Some(&key)).is_err());
        assert!(require_exact_origin(p("zt5a6-yiaaa-aaaal-qxp5q-cai"),caller,&scope(),&config(),&router(),&[caller],true,Some(&key)).is_err());
    }
    #[test]fn stale_directory_foreign_sources_and_invented_legacy_placement_fail(){
        let caller=p("iui5p-aaaaa-aaaal-qxllq-cai");
        let key=VERIFIED_DEV_PUBLIC_KEY_SHA256.to_string();
        let baseline=config();let inventory=router();
        let mut v=baseline.clone();v.binding.registry_revision=7;
        assert!(verify(&v,&inventory,caller,&scope(),&[caller],true,Some(&key)).is_err());
        let mut v=baseline.clone();v.generation=1;
        assert!(verify(&v,&inventory,caller,&scope(),&[caller],true,Some(&key)).is_err());
        let mut v=baseline.clone();v.release=None;
        assert!(verify(&v,&inventory,caller,&scope(),&[caller],true,Some(&key)).is_err());
        let mut v=baseline.clone();v.sources[0].1=p("yfwyv-nyaaa-aaaal-qxpyq-cai");
        assert!(verify(&v,&inventory,caller,&scope(),&[caller],true,Some(&key)).is_err());
        let mut snapshot=inventory.clone();snapshot.revision=12;
        assert!(verify(&baseline,&snapshot,caller,&scope(),&[caller],true,Some(&key)).is_err());
        let mut snapshot=inventory.clone();snapshot.groups[0].domains.push(
            group_inventory::Domain{domain:"pii_access_control".into(),canister:caller});
        assert!(verify(&baseline,&snapshot,caller,&scope(),&[caller],true,Some(&key)).is_err());
        let mut snapshot=inventory;snapshot.groups[0].domains[0].canister=caller;
        assert!(verify(&baseline,&snapshot,caller,&scope(),&[caller],true,Some(&key)).is_err());
    }
    #[test]fn compile_time_source_pin_never_admits_a_foreign_reader(){
        let id=p("mq2sj-fiaaa-aaaal-qxlqa-cai");
        let original=p("iui5p-aaaaa-aaaal-qxllq-cai");
        assert!(exact_original_dev_pii_caller(id,original));
        assert!(!exact_original_dev_pii_caller(id,p("zt5a6-yiaaa-aaaal-qxp5q-cai")));
        assert!(!exact_original_dev_pii_caller(original,original));
    }
    #[test]fn mismatched_malformed_or_short_key_refused_even_if_every_other_guard_passes(){
        let key=vec![3u8;96];
        let hash=format!("{:x}",Sha256::digest(&key));
        assert!(verify_current_public_key(&key,&hash).is_ok());
        assert!(verify_current_public_key(&key,&"0".repeat(64)).is_err());
        assert!(verify_current_public_key(&key[..90],&hash).is_err());
        assert!(verify_current_public_key(&key,&hash.to_uppercase()).is_err());
        assert!(verify_current_public_key(&key,"2026").is_err());
    }
}
