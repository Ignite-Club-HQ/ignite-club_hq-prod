module {
  // Existing installations retain direct derivation. Only the separately
  // built fresh-engine candidate selects its proxy at first initialization.
  public func migration(_ : {}) : { var establishedVetkdRoute : ?{ #Direct; #Proxy : Principal } } {
    { var establishedVetkdRoute = null }
  }
}