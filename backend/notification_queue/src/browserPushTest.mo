import Principal "mo:core/Principal";
module {
  public type Row = { owner : Principal; token : Text; id : Text; expires : Nat64; status : Text; worker : ?Principal };
  public func canClaim(row : Row, stamp : Nat64) : Bool { row.status == "pending" and stamp < row.expires };
  public func canSettle(row : Row, caller : Principal) : Bool { row.status == "sending" and row.worker == ?caller };
}