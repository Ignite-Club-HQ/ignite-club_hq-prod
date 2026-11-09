module {
  public func migration(_ : {}) : {
    var nativePushWorker : ?Principal;
    var nativePushSequence : Nat;
    var nativePushAttempts : [{ receipt : Text; notification_id : Text; user : Text; token : Text; platform : Text; device_stamp : Nat64; worker : Principal; status : Text }];
  } {
    { var nativePushWorker = null; var nativePushSequence = 0; var nativePushAttempts = [] }
  }
}