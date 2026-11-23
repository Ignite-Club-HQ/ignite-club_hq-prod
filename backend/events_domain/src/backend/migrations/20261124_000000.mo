module {
  // Fictional test players: team-scoped roster entries with no account,
  // guardian or PII. Starts empty.
  type TestPlayer = { id : Text; club_id : Text; team_id : Text; name : Text; shirt_number : ?Nat16; positions : [Text]; age_group : ?Text; created_by : Principal; created_at_ms : Nat64; updated_at_ms : Nat64 };
  public func migration(_ : {}) : { var testPlayers : [TestPlayer]; var testPlayerSeq : Nat } {
    { var testPlayers = []; var testPlayerSeq = 0 }
  };
}
