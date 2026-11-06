use super::*;

fn enable(reader:Principal,club:Principal) {
    GROUP2_ADMISSION.with(|m|m.borrow_mut().set(encode(&admission::Config {
        enabled:true,member_access:true,readers:vec![reader,club],club_readers:vec![club],
    })));
}
#[test]
fn ordinary_access_has_no_approval_expiry_dependency() {
    let reader=Principal::from_slice(&[1,80]);let club=Principal::from_slice(&[2,80]);
    enable(reader,club);
    assert!(production_authorization().approval.is_none());
    assert!(member_reader_access(reader,false).is_ok());
    assert!(member_reader_access(club,true).is_ok());
    assert!(member_reader_access(reader,true).is_err());
    assert!(member_reader_access(Principal::anonymous(),false).is_err());
    assert!(member_reader_access(Principal::from_slice(&[3,80]),false).is_err());
}
#[test]
fn legacy_saved_config_does_not_implicitly_release_account_aliases() {
    #[derive(Serialize)] struct Old {enabled:bool,readers:Vec<Principal>}
    let old:admission::Config=decode(&encode(&Old {enabled:true,readers:vec![Principal::from_slice(&[1,81])]}));
    assert!(!old.member_access);assert!(old.club_readers.is_empty());
}
#[test]
fn ordinary_access_keeps_pending_recovery_and_unlink_closed() {
    let reader=Principal::from_slice(&[1,82]);let club=Principal::from_slice(&[2,82]);enable(reader,club);
    RECOVERY_PENDING.with(|m|m.borrow_mut().insert("unknown-write".into(),vec![1]));
    assert!(member_reader_access(reader,false).is_err());
    RECOVERY_PENDING.with(|m|m.borrow_mut().remove(&"unknown-write".into()));
    assert!(member_reader_access(reader,false).is_ok());
}
#[test]
fn ordinary_access_defers_global_erasure_without_erasing_accounts() {
    let reader=Principal::from_slice(&[1,83]);let club=Principal::from_slice(&[2,83]);enable(reader,club);
    assert_eq!(deferred_account_operations_clear(),Err("Global account erasure and recovery are deferred".into()));
    assert!(current_removal_control_access().is_err());
    assert!(removal_control_access().is_err());
}
#[test]
fn ordinary_access_still_filters_revoked_aliases_and_deletion_tickets() {
    let subject=Principal::from_slice(&[1,84]);let revoked=Principal::from_slice(&[2,84]);
    let account=Account {id:"ordinary-member".into(),principals:vec![subject,revoked],version:4,status:AccountStatus::Active};
    put_account(&account);index_principal(subject,&account.id);index_principal(revoked,&account.id);
    deny_unlinked_principal(revoked,&account.id,4).unwrap();
    assert_eq!(current_service_account(subject).unwrap().principals,vec![subject]);
    assert!(current_service_account(revoked).is_err());
    DELETION_TICKETS.with(|m|m.borrow_mut().insert(account.id.clone(),vec![1]));
    assert_eq!(current_service_account(subject),Err("Account deletion pending".into()));
}
#[test]
fn production_inventory_requires_exact_24_readers_and_separate_stores() {
    let (s,mut b,_)=group_inventory::tests::fixture();
    b.target_alias="mainnet".into();b.deployment_id="prod".into();b.host="https://icp-api.io".into();
    let mut groups:Vec<_>=s.groups.into_iter().enumerate().map(|(i,g)|admission::Group {
        id:if i==0 {"base".into()}else{"g2".into()},target_alias:b.target_alias.clone(),domains:g.domains,
        photo_store:Some(Principal::from_slice(&[90+i as u8,85])),
    }).collect();
    let mut placements=s.placements;
    for (i,p) in placements.iter_mut().enumerate(){p.group_id=groups[i].id.clone();p.deployment_id=b.deployment_id.clone();p.host=b.host.clone();}
    let (readers,clubs)=admission::member_readers(&groups,&placements,&b).unwrap();
    assert_eq!(readers.len(),24);assert_eq!(clubs.len(),2);
    assert!(!readers.contains(&b.registry));
    let timer=groups[0].domains.iter().find(|d|d.domain=="timer_jobs").unwrap().canister;
    assert!(!readers.contains(&timer));
    groups[1].photo_store=groups[0].photo_store;
    assert!(admission::member_readers(&groups,&placements,&b).is_err());
}#[test]
fn member_reads_follow_newer_registry_revision_but_never_older() {
    let pinned=group_inventory::Binding{registry:Principal::from_slice(&[9,80]),registry_revision:4,target_alias:"mainnet".into(),
        deployment_id:"prod".into(),deployment_revision:1,host:"https://icp-api.io".into(),network_kind:"public_mainnet".into()};
    // Opening both groups moved the live PROD registry from 4 to 6.
    let live=advance_member_binding(&pinned,6).unwrap();
    assert_eq!(live.registry_revision,6);
    assert_eq!(live.registry,pinned.registry);assert_eq!(live.deployment_id,pinned.deployment_id);
    assert_eq!(advance_member_binding(&pinned,4).unwrap().registry_revision,4);
    assert!(advance_member_binding(&pinned,3).is_err());
}
