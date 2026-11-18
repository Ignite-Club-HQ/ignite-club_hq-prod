// Disposable PocketIC-only G2 caller. Never add to deployment mappings.
import Principal "mo:core/Principal";

shared ({ caller = installer }) persistent actor class G2ChainProbe(authority : Principal) {
  type Account = {
    id : Text;
    principals : [Principal];
    version : Nat64;
    status : { #Active; #Suspended };
  };
  public shared ({ caller }) func linked_account() : async { #Ok : Account; #Err : Text } {
    if (caller == Principal.fromText("2vxsx-fae")) return #Err("Authenticated G2 caller required");
    let service : actor {
      read_linked_account : shared (Principal) -> async { #Ok : Account; #Err : Text };
    } = actor (Principal.toText(authority));
    await service.read_linked_account(caller);
  };
};
