//! Offline comparison against independently reviewed expectations. Equality is
//! not provenance: this module cannot pin, release, erase or open anything.
use candid::Principal;
use std::collections::BTreeSet;
use crate::group_inventory::{self, RemovalInventory};

#[derive(Clone, Debug)]
pub(crate) struct ExpectedInventory {
    pub inventory: RemovalInventory,
    pub clubs: Vec<Principal>,
    pub readers: Vec<Principal>,
}

fn validate(inventory: &RemovalInventory, clubs: &[Principal], readers: &[Principal]) -> Result<(), String> {
    let groups = &inventory.groups.snapshot;
    let ids: BTreeSet<_> = groups.groups.iter().map(|g| g.id.as_str()).collect();
    if groups.groups.len() != 2 || ids != BTreeSet::from(["base", "g2"]) {
        return Err("Exact base and g2 inventory required".into());
    }
    for list in [clubs, readers] {
        let unique: BTreeSet<_> = list.iter().copied().collect();
        if list.is_empty() || list.len() > 4096 || unique.len() != list.len() ||
            list.iter().any(|p| *p == Principal::anonymous() || *p == Principal::management_canister()) {
            return Err("Distinct bounded expected authorities required".into());
        }
    }
    let actual_clubs: BTreeSet<_> = groups.groups.iter().flat_map(|g| g.domains.iter())
        .filter(|d| d.domain == "club_domain").map(|d| d.canister).collect();
    if actual_clubs != clubs.iter().copied().collect() { return Err("Exact expected club authorities required".into()); }
    group_inventory::validate_complete(groups, &inventory.groups.binding, clubs, readers,
        &inventory.supplemental, &inventory.media)
}

fn normalized(mut value: RemovalInventory) -> RemovalInventory {
    let snapshot = &mut value.groups.snapshot;
    snapshot.groups.sort_by(|a,b| a.id.cmp(&b.id));
    for g in &mut snapshot.groups { g.domains.sort_by(|a,b| a.domain.cmp(&b.domain)); }
    snapshot.placements.sort_by(|a,b| a.group_id.cmp(&b.group_id));
    for p in &mut snapshot.placements {
        p.domains.sort_by(|a,b| a.domain.cmp(&b.domain)); p.approved_subnets.sort();
    }
    value.supplemental.sort_by(|a,b| (&a.group_id,&a.domain,a.canister,a.subnet).cmp(&(&b.group_id,&b.domain,b.canister,b.subnet)));
    value.media.sort_by_key(|m| m.club_authority);
    for m in &mut value.media { m.registry.stores.sort(); }
    value
}

pub(crate) fn validate_exact(expected: &ExpectedInventory, observed: &RemovalInventory) -> Result<(), String> {
    validate(&expected.inventory, &expected.clubs, &expected.readers)?;
    validate(observed, &expected.clubs, &expected.readers)?;
    if normalized(expected.inventory.clone()) != normalized(observed.clone()) {
        return Err("Observed inventory differs from independently expected inventory".into());
    }
    Ok(())
}

#[cfg(test)] mod tests {
    use super::*;
    use crate::group_inventory::{Evidence, Supplemental, MediaEvidence, MediaRegistry};
    fn fixture() -> ExpectedInventory {
        let (mut snapshot, binding, clubs) = group_inventory::tests::fixture();
        for (i,g) in snapshot.groups.iter_mut().enumerate() { g.id = if i == 0 {"base"} else {"g2"}.into(); }
        for (i,p) in snapshot.placements.iter_mut().enumerate() { p.group_id = if i == 0 {"base"} else {"g2"}.into(); }
        let principal = |n| Principal::from_slice(&[n,1]);
        let supplemental = vec![
            Supplemental {group_id:"base".into(),domain:"media_blob_store".into(),canister:principal(91),subnet:principal(80)},
            Supplemental {group_id:"g2".into(),domain:"media_blob_store".into(),canister:principal(92),subnet:principal(80)},
            Supplemental {group_id:"base".into(),domain:"shard_router".into(),canister:binding.registry,subnet:principal(80)},
        ];
        let media = clubs.iter().enumerate().map(|(i,c)| MediaEvidence {club_authority:*c,
            registry:MediaRegistry {active:false,stores:vec![principal(91+i as u8)]}}).collect();
        ExpectedInventory {inventory:RemovalInventory {groups:Evidence {binding,history_revision:7,snapshot},supplemental,media},
            clubs,readers:vec![principal(1),principal(21),principal(91),principal(92)]}
    }
    #[test] fn exact_inventory_accepts_order_changes_without_releasing_anything() {
        let expected=fixture(); let mut observed=expected.inventory.clone();
        observed.groups.snapshot.groups.reverse(); observed.groups.snapshot.placements.reverse();
        observed.supplemental.reverse(); observed.media.reverse();
        assert_eq!(validate_exact(&expected,&observed),Ok(()));
    }
    #[test] fn internally_consistent_omission_of_original_infrastructure_is_rejected() {
        let expected=fixture(); let mut observed=expected.inventory.clone(); observed.supplemental.pop();
        assert!(validate(&observed,&expected.clubs,&expected.readers).is_ok());
        assert!(validate_exact(&expected,&observed).is_err());
    }
    #[test] fn history_and_registry_binding_drift_are_rejected() {
        let expected=fixture();
        let mut observed=expected.inventory.clone(); observed.groups.history_revision+=1;
        assert!(validate_exact(&expected,&observed).is_err());
        let mut observed=expected.inventory.clone(); observed.groups.binding.registry=Principal::from_slice(&[99,1]);
        assert!(validate_exact(&expected,&observed).is_err());
    }
    #[test] fn duplicate_authorities_and_media_rows_are_rejected_before_normalization() {
        let mut expected=fixture(); expected.readers.push(expected.readers[0]);
        assert!(validate_exact(&expected,&expected.inventory).is_err());
        let expected=fixture();let mut observed=expected.inventory.clone();observed.media.push(observed.media[0].clone());
        assert!(validate_exact(&expected,&observed).is_err());
        let mut observed=expected.inventory.clone();observed.supplemental.push(observed.supplemental[0].clone());
        assert!(validate_exact(&expected,&observed).is_err());
    }
    #[test] fn omitted_groups_and_extra_allowlisted_authorities_are_rejected() {
        let expected=fixture();let mut observed=expected.inventory.clone();observed.groups.snapshot.groups.pop();
        assert!(validate_exact(&expected,&observed).is_err());
        let mut observed=expected.inventory.clone();observed.supplemental.push(Supplemental {group_id:"base".into(),
            domain:"vault_domain".into(),canister:Principal::from_slice(&[98,1]),subnet:Principal::from_slice(&[80,1])});
        assert!(validate(&observed,&expected.clubs,&expected.readers).is_ok());
        assert!(validate_exact(&expected,&observed).is_err());
    }
    #[test] fn foreign_store_owner_and_role_substitution_are_rejected() {
        let expected=fixture();let mut observed=expected.inventory.clone();observed.supplemental[0].group_id="g2".into();
        assert!(validate_exact(&expected,&observed).is_err());
        let mut observed=expected.inventory.clone();observed.supplemental[2].domain="placement_registry".into();
        assert!(validate(&observed,&expected.clubs,&expected.readers).is_ok());
        assert!(validate_exact(&expected,&observed).is_err());
    }
}