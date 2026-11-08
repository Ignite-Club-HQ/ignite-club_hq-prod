module {
  public func migration(_ : {}) : { var browserPushTests : [{ owner : Principal; token : Text; id : Text; expires : Nat64; status : Text; worker : ?Principal }] } {
    { var browserPushTests = [] }
  }
}