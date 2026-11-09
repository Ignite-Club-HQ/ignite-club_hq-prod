// Disposable local actor. Never map or install on deployed DEV/PROD services.
import Cycles "mo:core/Cycles";
import Timer "mo:core/Timer";

persistent actor {
  var directoryTicks : Nat = 0;
  var cleanupTicks : Nat = 0;
  transient var directoryTimer : ?Timer.TimerId = null;
  transient var cleanupTimer : ?Timer.TimerId = null;

  public func armAndDrain(timers : Bool, keep : Nat) : async Nat {
    switch (directoryTimer) { case (?id) Timer.cancelTimer(id); case null {} };
    switch (cleanupTimer) { case (?id) Timer.cancelTimer(id); case null {} };
    directoryTimer := null;
    cleanupTimer := null;
    directoryTicks := 0;
    cleanupTicks := 0;
    if (timers) {
      directoryTimer := ?Timer.recurringTimer<system>(#seconds 30, func() : async () { directoryTicks += 1 });
      cleanupTimer := ?Timer.recurringTimer<system>(#seconds 60, func() : async () { cleanupTicks += 1 });
    };
    let before = Cycles.balance();
    if (before > keep) ignore Cycles.burn<system>(before - keep);
    Cycles.balance()
  };

  public query func counts() : async { directory : Nat; cleanup : Nat } {
    { directory = directoryTicks; cleanup = cleanupTicks }
  };
}