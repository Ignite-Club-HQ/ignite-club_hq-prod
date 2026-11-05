module {
  // (team_id, class schedule) for class-mode teams. Types frozen inline.
  public func migration(_ : {}) : {
    var teamClassSchedules : [(Text, { day : Text; time : ?Text; duration_minutes : ?Nat; capacity : ?Nat })]
  } {
    { var teamClassSchedules = [] }
  }
}
