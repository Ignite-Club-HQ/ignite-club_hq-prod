module {
  // (kind, entity id, club id, action, actor, at_ms) for club/team delete/restore. Types frozen inline.
  public func migration(_ : {}) : {
    var entityDeletionAudit : [(Text, Text, Text, Text, Principal, Nat64)]
  } {
    { var entityDeletionAudit = [] }
  }
}
