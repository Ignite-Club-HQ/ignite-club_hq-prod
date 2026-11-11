import Principal "mo:core/Principal";

module {
  public type Result = { #Ok; #Err : Text };

  // Select before the call; a refused protected read must never retry legacy.
  public func authorize(
    caller : Principal,
    protectedReads : Bool,
    legacy : Principal -> async Bool,
    protectedRead : Principal -> async Bool,
  ) : async Result {
    if (Principal.isAnonymous(caller)) return #Err("App admin required");
    let allowed = try {
      if (protectedReads) await protectedRead(caller) else await legacy(caller)
    } catch (_) { return #Err("App admin verification unavailable") };
    if (allowed) #Ok else #Err("App admin required")
  };
}