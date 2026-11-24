import Map "mo:core/Map";
module {
  public func migration(_ : {}) : {
    var pitchSubAlerts : Map.Map<Text, { owner : Text; club : Text; users : [Text]; related : Text; alerts : [{ key : Text; due_ms : Nat64 }] }>
  } {
    { var pitchSubAlerts = Map.empty<Text, { owner : Text; club : Text; users : [Text]; related : Text; alerts : [{ key : Text; due_ms : Nat64 }] }>() }
  }
}
