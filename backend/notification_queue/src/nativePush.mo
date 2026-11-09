import Array "mo:core/Array";
module {
  public type Attempt = { receipt : Text; notification_id : Text; user : Text; token : Text; platform : Text; device_stamp : Nat64; worker : Principal; status : Text };
  public func occupied(attempts : [Attempt], id : Text, token : Text, stamp : Nat64) : Bool {
    attempts.any(func a = a.notification_id == id and a.token == token and a.device_stamp == stamp)
  };
  public func terminal(outcome : Text) : Bool {
    outcome == "accepted" or outcome == "held" or outcome == "inactive" or outcome == "stopped"
  };
  public func canSettle(a : Attempt, caller : Principal, outcome : Text) : Bool {
    a.worker == caller and terminal(outcome) and (a.status == "sending" or a.status == outcome)
  };
}