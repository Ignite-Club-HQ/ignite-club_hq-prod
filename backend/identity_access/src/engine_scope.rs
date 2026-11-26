//! Deployment scope for the production account-protection and ordinary member
//! access protocols. Mainnet keeps its exact PROD pin. An OpenCloud engine
//! identity (canister setting IGNITE_CLOUD_ENGINE=1) accepts ONLY its own
//! engine binding — never a mainnet binding — so the same signed/witnessed
//! commissioning applies with environment-specific IDs instead of mainnet pins.
use crate::group_inventory::Binding;

pub const ENGINE_DEPLOYMENTS: [&str; 2] = ["opencloud-dev", "opencloud-prod"];

pub fn engine_binding(b: &Binding) -> bool {
    let host_ok = b.host.strip_prefix("https://").is_some_and(|h| !h.is_empty() && !h.contains(['/', '@', '?', '#'])
        && !["icp-api.io", "ic0.app", "icp0.io"].contains(&h));
    b.network_kind == "cloud_engine" && b.target_alias == b.deployment_id &&
        ENGINE_DEPLOYMENTS.contains(&b.deployment_id.as_str()) && host_ok
}

pub fn production_binding(b: &Binding, engine: bool) -> bool {
    if engine { return engine_binding(b); }
    b.target_alias == "mainnet" && b.deployment_id == "prod" && b.host == "https://icp-api.io" && b.network_kind == "public_mainnet"
}

#[cfg(test)] mod tests {
    use super::*;
    fn b(alias: &str, host: &str, kind: &str) -> Binding {
        Binding { registry: candid::Principal::from_slice(&[9, 1]), registry_revision: 1, target_alias: alias.into(),
            deployment_id: alias.into(), deployment_revision: 1, host: host.into(), network_kind: kind.into() }
    }
    #[test] fn engine_and_mainnet_scopes_never_cross() {
        let engine = b("opencloud-dev", "https://engine.example", "cloud_engine");
        let mut main = b("mainnet", "https://icp-api.io", "public_mainnet"); main.deployment_id = "prod".into();
        assert!(production_binding(&engine, true) && !production_binding(&engine, false));
        assert!(production_binding(&main, false) && !production_binding(&main, true));
        assert!(!engine_binding(&b("opencloud-dev", "https://icp-api.io", "cloud_engine")));
        assert!(!engine_binding(&b("mainnet", "https://engine.example", "cloud_engine")));
        assert!(!engine_binding(&b("opencloud-dev", "http://engine.example", "cloud_engine")));
    }
}
