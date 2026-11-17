// Disposable emulator fixture only; never deploy to an engine or mainnet.
import Principal "mo:core/Principal";
import Blob "mo:core/Blob";
import Nat8 "mo:core/Nat8";
import Management "mo:ic-vetkeys/ManagementCanister";
import Adapter "../../backend/pii_access_control/src/EngineVetKd";

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
        let args : ?{ canister_id : ?Principal; context : Blob; key_id : Management.VetKdKeyid } = from_candid(request.args);
        switch (args) {
          case null { assert false; #Err(#UnauthorizedUser) };
          case (?a) {
            let public_key = await Management.vetKdPublicKey(null, scoped(caller, a.context), a.key_id);
            #Ok({ result = to_candid({ public_key }) })
          }
        }
      };
      case "vetkd_derive_key" {
        assert request.cycles == 30_000_000_000;
        let args : ?{ context : Blob; input : Blob; key_id : Management.VetKdKeyid; transport_public_key : Blob } = from_candid(request.args);
        switch (args) {
          case null { assert false; #Err(#UnauthorizedUser) };
          case (?a) {
            let encrypted_key = await Management.vetKdDeriveKey(a.input, scoped(caller, a.context), a.key_id, a.transport_public_key);
            #Ok({ result = to_candid({ encrypted_key }) })
          }
        }
      };
      case _ { #Err(#UnauthorizedUser) }
    }
  }
}