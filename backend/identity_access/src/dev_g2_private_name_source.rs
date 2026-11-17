//! DEV-only registered Group 2 PII service admission for club-wide names.
//! This is a *service-to-service* reader entry, not a browser grant. The
//! existing profile-owner binding, current viewer+subject club membership,
//! double relationship checks and original-source rules remain mandatory.
use candid::Principal;

const IDENTITY: &str = "mq2sj-fiaaa-aaaal-qxlqa-cai";
const G2_PII: &str = "zt5a6-yiaaa-aaaal-qxp5q-cai";
const G2_CLUB: &str = "yfwyv-nyaaa-aaaal-qxpyq-cai";

fn pinned(value: &str) -> Principal {
    Principal::from_text(value).expect("reviewed DEV canister principal")
}

/// A default-off fallback for the exact pinned DEV PII when the historically
/// persisted service-reader allowlist does not yet contain registered G2 PII.
/// No broader identity-service allowlist is modified.
pub(crate) fn candidate(
    self_id: Principal,
    caller_service: Principal,
    kind: &str,
    audience_authority: Principal,
    dev_shared_club_names_released: bool,
    private_club_displays_released: bool,
) -> bool {
    self_id == pinned(IDENTITY)
        && caller_service == pinned(G2_PII)
        && audience_authority == pinned(G2_CLUB)
        && kind == "club"
        && dev_shared_club_names_released
        && private_club_displays_released
}

/// This proof must come from the independently pinned live router registry,
/// never a user-supplied PII origin or a guessed team/club relationship.
pub(crate) fn registered_same_group(
    candidate: bool,
    registry_has_exact_g2_pair: bool,
) -> bool {
    !candidate || registry_has_exact_g2_pair
}

#[cfg(test)]
mod tests {
    use super::*;
    fn ok() -> bool {
        candidate(
            pinned(IDENTITY), pinned(G2_PII), "club", pinned(G2_CLUB), true, true,
        )
    }
    #[test]
    fn admits_only_operator_released_exact_dev_group2_service() {
        assert!(ok());
        assert!(registered_same_group(ok(), true));
        assert!(!registered_same_group(ok(), false));
    }
    #[test]
    fn never_approves_foreign_canisters_schemes_scopes_or_unreleased_routes() {
        let exact = pinned(IDENTITY);
        let g2 = pinned(G2_PII);
        let club = pinned(G2_CLUB);
        let foreign = Principal::from_text("iui5p-aaaaa-aaaal-qxllq-cai").unwrap();
        let prod = Principal::from_text("aaaaa-aa").unwrap();
        for (identity, service, kind, authority, shared, display) in [
            (prod, g2, "club", club, true, true),
            (exact, foreign, "club", club, true, true),
            (exact, g2, "team", club, true, true),
            (exact, g2, "family", club, true, true),
            (exact, g2, "club", foreign, true, true),
            (exact, g2, "club", club, false, true),
            (exact, g2, "club", club, true, false),
        ] {
            assert!(!candidate(identity, service, kind, authority, shared, display));
        }
    }
}
