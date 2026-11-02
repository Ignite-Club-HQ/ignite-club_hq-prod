// Disposable PocketIC-only reader. Never add to deployment mappings.
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";

shared ({ caller = installer }) persistent actor class RecoveryLifecycleProbe() {
  let owner = installer;
  type Info = {
    total_num_changes : Nat64;
    module_hash : ?Blob;
  };
  transient let management : actor {
    canister_info : shared {
      canister_id : Principal;
      num_requested_changes : ?Nat64;
    } -> async Info;
  } = actor ("aaaaa-aa");

  public shared ({ caller }) func read_lifecycle(canister : Principal) : async Info {
    if (Principal.isAnonymous(caller) or caller != owner) {
      Runtime.trap("Isolated lifecycle reader owner required");
    };
    // Real inter-canister management call, not ingress with a forged sender.
    await management.canister_info({ canister_id = canister; num_requested_changes = ?0 });
  };
}