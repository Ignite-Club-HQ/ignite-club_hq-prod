import Management "mo:ic-vetkeys/ManagementCanister";
import Principal "mo:core/Principal";
import Error "mo:core/Error";
import Runtime "mo:core/Runtime";

module {
  public type ProxyArgs = { canister_id : Principal; method : Text; args : Blob; cycles : Nat };
  public type ProxyResult = {
    #Ok : { result : Blob };
    #Err : { #InsufficientCycles : { available : Nat; required : Nat }; #CallFailed : { reason : Text }; #UnauthorizedUser };
  };
  public type Proxy = actor { proxy : shared ProxyArgs -> async ProxyResult };
  // Send the ORIGINAL context: the console proxy prefixes the calling
  // canister principal itself. Prefixing here would derive a different key.
  public func publicRequest(context : Blob, key : Management.VetKdKeyid) : ProxyArgs {
    { canister_id = Principal.fromText("aaaaa-aa"); method = "vetkd_public_key";
      args = to_candid ({ canister_id = null : ?Principal; context; key_id = key }); cycles = 0 }
  };
  public func deriveRequest(input : Blob, context : Blob, key : Management.VetKdKeyid, transport : Blob) : ProxyArgs {
    { canister_id = Principal.fromText("aaaaa-aa"); method = "vetkd_derive_key";
      args = to_candid ({ context; input; key_id = key; transport_public_key = transport }); cycles = 30_000_000_000 }
  };
  public func select(established : { #Direct; #Proxy : Principal }, configured : ?Text) : ?Principal {
    let wanted = switch (configured) {
      case null null;
      case (?text) {
        let p = Principal.fromText(text);
        if (p.isAnonymous() or p == Principal.fromText("aaaaa-aa")) Runtime.trap("Invalid encryption proxy");
        ?p
      }
    };
    switch (established) {
      case (#Direct) { if (wanted != null) Runtime.trap("Original direct encryption authority must be retained"); null };
      case (#Proxy p) { if (wanted != ?p) Runtime.trap("Original encryption proxy must be retained"); ?p }
    }
  };
  func relay(p : Principal, request : ProxyArgs) : async Blob {
    let proxy : Proxy = actor(p.toText());
    // No attached cycles, no retry: a rejected/unknown downstream outcome
    // must not silently repeat a paid derivation.
    switch (await (with timeout = 30) proxy.proxy(request)) {
      case (#Ok reply) reply.result;
      case (#Err _) throw Error.reject("Encryption key service unavailable")
    }
  };
  public func publicKey(p : Principal, context : Blob, key : Management.VetKdKeyid) : async Blob {
    let bytes = await relay(p, publicRequest(context, key));
    let reply : ?{ public_key : Blob } = from_candid(bytes);
    switch (reply) { case (?r) r.public_key; case null throw Error.reject("Invalid encryption public key response") }
  };
  public func derive(p : Principal, input : Blob, context : Blob, key : Management.VetKdKeyid, transport : Blob) : async Blob {
    let bytes = await relay(p, deriveRequest(input, context, key, transport));
    let reply : ?{ encrypted_key : Blob } = from_candid(bytes);
    switch (reply) { case (?r) r.encrypted_key; case null throw Error.reject("Invalid encrypted key response") }
  };
}