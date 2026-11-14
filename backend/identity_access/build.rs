// A feature flag alone is insufficient to compile the test-only G2 account
// reader. Keep both checks in the compiler, independent of release scripts.
fn main() {
    println!("cargo:rerun-if-env-changed=IGNITE_ISOLATED_G2_FIXTURE_BUILD");
    if std::env::var_os("CARGO_FEATURE_ISOLATED_G2_CHAIN_FIXTURE").is_none() {
        return;
    }
    if std::env::var("IGNITE_ISOLATED_G2_FIXTURE_BUILD").as_deref()
        != Ok("POCKETIC_ONLY_NOT_DEPLOYABLE")
    {
        panic!("Refusing isolated G2 fixture compilation outside an explicit disposable PocketIC build");
    }
}
