module {
  // Club/team switches for the fictional test-players feature. Types frozen
  // inline (never Types.X) so this applied step can never be rewritten.
  // Empty = club master switch off, so test players stay hidden everywhere
  // until a club admin turns them on.
  type TestPlayersSwitch = { club_id : Text; team_id : ?Text; enabled : Bool };
  public func migration(_ : {}) : { var testPlayersSwitches : [TestPlayersSwitch] } {
    { var testPlayersSwitches = [] }
  };
}
