// Disposable local-test actor, never a production service or release artifact.
persistent actor RemovalInstallProbe {
  public query func ping() : async Nat { 1 };
}