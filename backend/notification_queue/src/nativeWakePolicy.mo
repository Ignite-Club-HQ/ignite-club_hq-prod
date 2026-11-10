module {
  public let backupSeconds : Nat = 60;
  public let retrySeconds : Nat = 5;
  public let scanLimit : Nat = 200;

  // Retry only the content-free wake, never a Firebase send or reservation.
  public func retry(attempt : Nat, status : ?Nat) : Bool {
    if (attempt >= 1) return false;
    switch (status) {
      case null true;
      case (?code) code < 200 or code >= 300;
    }
  };
  public func waiting(pending : Bool, allowed : Bool, fenced : Bool) : Bool {
    pending and allowed and not fenced
  };
}