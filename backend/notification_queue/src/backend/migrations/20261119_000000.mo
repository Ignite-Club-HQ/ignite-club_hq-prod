module {
  public func migration(_ : {}) : { var nativePushRollout : ?{ enabled : Bool; started_at_ms : Nat64 } } {
    { var nativePushRollout = null }
  }
}