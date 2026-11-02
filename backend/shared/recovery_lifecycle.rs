//! Replicated lifecycle counter, not ic0.canister_version (which advances on updates).
//! Kept live: snapshots must not roll this evidence back with application state.
pub async fn current_changes() -> Result<u64, String> {
    let info = ic_cdk::management_canister::canister_info(
        &ic_cdk::management_canister::CanisterInfoArgs {
            canister_id: ic_cdk::api::canister_self(),
            num_requested_changes: Some(0),
        },
    ).await.map_err(|_| "Recovery lifecycle unavailable")?;
    if info.module_hash.is_none() || info.total_num_changes == 0 {
        return Err("Installed recovery lifecycle required".into());
    }
    Ok(info.total_num_changes)
}

pub fn check_armed(armed: u64, live: u64) -> Result<(), String> {
    if armed == 0 || armed != live {
        return Err("Witness restored or upgraded; independent reacceptance required".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ordinary_updates_do_not_require_a_new_lifecycle_acceptance() {
        for _ in 0..100 { assert!(check_armed(4, 4).is_ok()); }
    }
    #[test]
    fn_restore_or_same_module_upgrade_never_reuses_armed_evidence() {
        assert!(check_armed(4, 5).is_err());
        assert!(check_armed(4, 3).is_err());
        assert!(check_armed(0, 4).is_err());
    }
}