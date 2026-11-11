module {
  public let maxAgeMs : Nat64 = 1_800_000;
  public type State = { enabled : Bool; started_at_ms : Nat64 };
  public func fresh(created : Nat64, now : Nat64) : Bool {
    created <= now and now - created <= maxAgeMs
  };
  public func eligible(state : ?State, created : Nat64, now : Nat64) : Bool {
    switch (state) {
      case null fresh(created, now);
      case (?s) created >= s.started_at_ms and fresh(created, now);
    }
  };
  public func allowed(isLive : Bool, isPilot : Bool, state : ?State) : Bool {
    if (not isLive or isPilot) return true;
    switch (state) { case (?s) s.enabled; case null false }
  };
}