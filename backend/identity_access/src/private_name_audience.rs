//! Request-scoped selectors; no persisted reader grants or readable name index.
use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, CandidType, Deserialize, Serialize, PartialEq, Eq)]
pub struct Scope {
    pub kind: String,
    pub authority: Principal,
    pub resource: String,
    pub profile_revision: u64,
}
/// Only this shared identity authority verifies global admin names. Source
/// admission still requires a complete live registry proof in the endpoint.
pub fn admin_source_candidate(scope: &Scope, identity: Principal) -> bool {
    scope.kind == "app_admin" && scope.resource == "all" && scope.authority == identity
}
/// Called only after the endpoint validates the complete consensus inventory.
pub fn registered_pii_source(inventory: &crate::group_inventory::Snapshot, service: Principal) -> bool {
    inventory.groups.iter().any(|g| g.domains.iter().any(|d| d.domain == "pii_access_control" && d.canister == service))
}
pub fn validate(viewer: Principal, subjects: &[Principal], scope: &Scope) -> Result<(), String> {
    if viewer == Principal::anonymous() || viewer == Principal::management_canister()
        || scope.authority == Principal::anonymous() || scope.authority == Principal::management_canister()
        || scope.resource.trim().is_empty() || scope.resource.trim() != scope.resource || scope.resource.len() > 128
        || !["club", "team", "family", "competition", "league", "guardian_search", "direct", "broadcast", "competition_admin", "app_admin"].contains(&scope.kind.as_str())
        || (scope.kind == "app_admin" && scope.resource != "all")
        || (scope.kind == "competition_admin" && subjects.is_empty())
        || (scope.kind == "broadcast" && (!scope.resource.starts_with("msg-broadcast-") || subjects.is_empty()))
        || (scope.kind == "direct" && subjects.len() > 2)
        || subjects.len() > 25 || subjects.iter().any(|p| *p == Principal::anonymous() || *p == Principal::management_canister())
        || subjects.iter().collect::<std::collections::BTreeSet<_>>().len() != subjects.len() {
        return Err("Exact bounded private-name audience required".into());
    }
    Ok(())
}
#[cfg(test)] mod tests {
    use super::*;
    fn p(n: u8) -> Principal { Principal::from_slice(&[n, 1]) }
    fn scope(kind: &str) -> Scope { Scope { kind: kind.into(), authority: p(1), resource: "child-1".into(), profile_revision: 7 } }
    #[test] fn only_the_five_name_audiences_are_accepted() {
        for kind in ["club", "team", "family", "competition", "league", "guardian_search"] { assert!(validate(p(2), &[p(3)], &scope(kind)).is_ok()); }
        assert!(validate(p(2), &[p(3)], &scope("email")).is_err());
        assert!(validate(p(2), &[p(3)], &scope("media")).is_err());
    }
    #[test] fn exact_child_and_distinct_bounded_humans_are_required() {
        let mut s = scope("guardian_search"); s.resource.clear(); assert!(validate(p(2), &[p(3)], &s).is_err());
        let s = scope("family");
        assert!(validate(Principal::anonymous(), &[p(3)], &s).is_err());
        assert!(validate(p(2), &[p(3), p(3)], &s).is_err());
        assert!(validate(p(2), &(0..26).map(p).collect::<Vec<_>>(), &s).is_err());
        assert!(validate(p(2), &[Principal::anonymous()], &s).is_err());
    }
    #[test] fn direct_names_are_exact_two_person_requests_not_broadcasts() {
        assert!(validate(p(2), &[p(3)], &scope("direct")).is_ok());
        assert!(validate(p(2), &[p(2), p(3)], &scope("direct")).is_ok());
        assert!(validate(p(2), &[p(2), p(3), p(4)], &scope("direct")).is_err());
        assert!(validate(p(2), &[p(3)], &scope("broadcast")).is_err());
        assert!(validate(p(2), &[p(3)], &scope("competition_admin")).is_ok());
        assert!(validate(p(2), &[], &scope("competition_admin")).is_err());
    }
    #[test] fn broadcast_names_require_the_canonical_resource_and_bounded_subjects() {
        let mut s=scope("broadcast"); s.resource="msg-broadcast-1".into();
        assert!(validate(p(2), &[p(3)], &s).is_ok());
        assert!(validate(p(2), &[], &s).is_err());
        assert!(validate(p(2), &(0..26).map(p).collect::<Vec<_>>(), &s).is_err());
        assert!(validate(p(2), &[p(3), p(3)], &s).is_err());
        s.resource="other".into(); assert!(validate(p(2), &[p(3)], &s).is_err());
    }
    #[test] fn app_admin_scope_requires_the_all_resource() {
        assert!(validate(p(9), &[p(2)], &Scope { kind: "app_admin".into(), authority: p(1), resource: "all".into(), profile_revision: 0 }).is_ok());
        assert!(validate(p(9), &[p(2)], &Scope { kind: "app_admin".into(), authority: p(1), resource: "club-1".into(), profile_revision: 0 }).is_err());
    }
    #[test] fn cross_group_admin_source_requires_shared_identity_and_names_scope() {
        let mut s = Scope { kind: "app_admin".into(), authority: p(1), resource: "all".into(), profile_revision: 0 };
        assert!(admin_source_candidate(&s, p(1)));
        assert!(!admin_source_candidate(&s, p(2)));
        s.kind = "club".into(); assert!(!admin_source_candidate(&s, p(1)));
        s.kind = "app_admin".into(); s.resource = "email".into(); assert!(!admin_source_candidate(&s, p(1)));
    }
    #[test] fn names_admit_original_services_from_every_group_not_other_registered_domains() {
        use crate::group_inventory::{Snapshot, Group, Domain};
        let inventory = Snapshot { revision: 1, placements: vec![], groups: (1..=3).map(|n| Group {
            id: format!("g{n}"), target_alias: "mainnet".into(), domains: vec![
                Domain { domain: "pii_access_control".into(), canister: p(n) },
                Domain { domain: "club_domain".into(), canister: p(n+10) },
            ]
        }).collect() };
        for service in [p(1), p(2), p(3)] { assert!(registered_pii_source(&inventory, service)); }
        assert!(!registered_pii_source(&inventory, p(11)));
        assert!(!registered_pii_source(&inventory, p(20)));
    }
}
