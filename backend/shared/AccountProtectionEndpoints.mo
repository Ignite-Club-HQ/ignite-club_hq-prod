import Protection "AccountProtection";
import Principal "mo:core/Principal";

// Authenticated consensus read of the actual guard's effective mode. No state,
// secrets, supplied readiness boolean, admission or removal mutation.
mixin (value : Protection.Mode, authority : ?Principal, self : Principal) {
  public shared ({ caller }) func read_account_protection_configuration() : async { #Ok : Protection.Configuration; #Err : Text } {
    if (Principal.isAnonymous(caller) or authority != ?caller) return #Err("Configured identity authority required");
    #Ok(Protection.configuration(value, authority, self))
  };
}