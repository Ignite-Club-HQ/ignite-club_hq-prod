//! DEV mainnet Group 2 club-only account-link reader policy.
 //! The public signup path is not an authority. This authorizes just the
 //! existing club-domain canister after governor review of live router/receiver.
use candid::{CandidType, Principal};
use serde::Deserialize;
use crate::group_inventory::{Binding, Domain, Placement, Snapshot, Group};

pub const ROUTER_ID: &str = "jcdfe-vqaaa-aaaal-qxloq-cai";
pub const IDENTITY_ID: &str = "mq2sj-fiaaa-aaaal-qxlqa-cai";
pub const CLUB_ID: &str = "yfwyv-nyaaa-aaaal-qxpyq-cai";

#[derive(Clone, Debug, CandidType, Deserialize, PartialEq)]
pub struct OpenGroup {
    pub id: String,
    pub target_alias: String,
    pub accepting: bool,
    pub domains: Vec<Domain>,
}

#[derive(Clone, Debug, CandidType, Deserialize)]
pub struct OpenPage {
    pub revision: u64,
    pub groups: Vec<OpenGroup>,
    pub placements: Vec<Placement>,
    pub next_cursor: Option<String>,
}

pub fn verify_open_g2_club(
    binding: &Binding, groups: &[OpenGroup], placements: &[Placement],
    self_id: Principal,
) -> Result<Principal, String> {
    if self_id != Principal::from_text(IDENTITY_ID).map_err(|_| "Invalid DEV identity pin")? ||
       binding.registry != Principal::from_text(ROUTER_ID).map_err(|_| "Invalid DEV router pin")? ||
       binding.target_alias != "mainnet" || binding.deployment_id != "mainnet" ||
       binding.host != "https://icp-api.io" || binding.network_kind != "public_mainnet" ||
       groups.len() != 1 || placements.len() != 1 ||
       groups[0].id != "g2" || !groups[0].accepting {
        return Err("Exact active DEV Group 2 identity and router required".into());
    }
    let snapshot = Snapshot {
        revision: binding.registry_revision,
        groups: groups.iter().map(|g| Group {
            id: g.id.clone(), target_alias: g.target_alias.clone(),
            domains: g.domains.clone(),
        }).collect(),
        placements: placements.to_vec(),
    };
    let club = groups[0].domains.iter()
        .find(|d| d.domain == "club_domain")
        .ok_or("Group 2 club authority missing")?.canister;
    crate::group_inventory::validate(&snapshot, binding, &[club], &[])?;
    if club != Principal::from_text(CLUB_ID).map_err(|_| "Invalid DEV club pin")? {
        return Err("Group 2 club authority differs from reviewed DEV canister".into());
    }
    Ok(club)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refuse_prod_base_foreign_router_and_wrong_opening() {
        let (mut s, mut b, _) = crate::group_inventory::tests::fixture();
        b.target_alias = "mainnet".into();
        b.deployment_id = "mainnet".into();
        b.host = "https://icp-api.io".into();
        b.registry = Principal::from_text(ROUTER_ID).unwrap();
        let service = Principal::from_text(IDENTITY_ID).unwrap();
        let bad: Vec<OpenGroup> = s.groups.iter().map(|g| OpenGroup {
            id: g.id.clone(), target_alias: b.target_alias.clone(),
            accepting: true, domains: g.domains.clone(),
        }).collect();
        assert!(verify_open_g2_club(&b,&bad,&s.placements,service).is_err());
        let only = vec![OpenGroup {id:"g2".into(), accepting:true, ..bad[0].clone()}];
        s.placements.truncate(1);
        s.placements[0].group_id = "g2".into();
        s.placements[0].deployment_id = "mainnet".into();
        s.placements[0].host = b.host.clone();
        assert!(verify_open_g2_club(&b,&only,&s.placements,service).is_err()); // non-pinned fake club
        let mut prod = b.clone();prod.deployment_id = "prod".into();
        assert!(verify_open_g2_club(&prod,&only,&s.placements,service).is_err());
        let mut wrong = b.clone();wrong.registry = Principal::anonymous();
        assert!(verify_open_g2_club(&wrong,&only,&s.placements,service).is_err());
        assert!(verify_open_g2_club(&b,&only,&s.placements,Principal::anonymous()).is_err());
        let mut closed=only.clone();closed[0].accepting=false;
        assert!(verify_open_g2_club(&b,&closed,&s.placements,service).is_err());
    }
}
