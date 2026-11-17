// Disposable emulator fixture only; never deploy to an engine or mainnet.
import Principal "mo:core/Principal";
import Blob "mo:core/Blob";
import Nat8 "mo:core/Nat8";
import Management "mo:ic-vetkeys/ManagementCanister";
import Adapter "../../../backend/pii_access_control/src/EngineVetKd";

persistent actor {
  func scoped(caller : Principal, context : Blob) : Blob {
    let bytes = Principal.toBlob(caller).toArray();
    Blob.fromArray([Nat8.fromNat(bytes.size())].concat(bytes).concat(context.toArray()))
  };
  public shared ({ caller }) func proxy(request : Adapter.ProxyArgs) : async Adapter.ProxyResult {
    assert request.canister_id == Principal.fromText("aaaaa-aa");
    switch (request.method) {
      case "vetkd_public_key" {
        assert request.cycles == 0;
        let args : ?Management.VetKdPublicKeyArgs = from_candid(request.args);
        switch (args) {
          case null { assert false; #Err(#UnauthorizedUser) };
          case (?a) {
            let result = await Management.vetkd_public_key({ a with canister_id = null; context = scoped(caller, a.context) });
            #Ok({ result = to_candid(result) })
          }
        }
      };
      case "vetkd_derive_key" {
        assert request.cycles == 30_000_000_000;
        let args : ?Management.VetKdDeriveKeyArgs = from_candid(request.args);
        switch (args) {
          case null { assert false; #Err(#UnauthorizedUser) };
          case (?a) {
            let result = await Management.vetkd_derive_key({ a with context = scoped(caller, a.context) });
            #Ok({ result = to_candid(result) })
          }
        }
      };
      case _ { #Err(#UnauthorizedUser) }
    }
  }
}