// Candidate production configuration; no deployment script enables it.
// Admission and removal control are separate capabilities. Account aliases,
// private-name protocols, erasure and routing approval are not released here.
import Principal "mo:core/Principal";
module {
  public type Configuration = { receiver : Principal; authority : ?Principal; protocol : Nat32;
    admission_required : Bool; removal_enabled : Bool; rehearsal : Bool };
  public func configuration(value : Mode, authority : ?Principal, receiver : Principal) : Configuration {
    { receiver; authority; protocol = 1; admission_required = admissionRequired(value);
      removal_enabled = removalEnabled(value); rehearsal = value == #Rehearsal }
  };
  public type Mode = { #Legacy; #Rehearsal; #ProductionAdmission; #ProductionRemoval; #Invalid };
  public func mode(rehearsal : Bool, admission : Bool, removal : Bool) : Mode {
    if (rehearsal and (admission or removal)) return #Invalid;
    if (removal and not admission) return #Invalid;
    if (rehearsal) #Rehearsal else if (removal) #ProductionRemoval else if (admission) #ProductionAdmission else #Legacy
  };
  public func admissionRequired(value : Mode) : Bool { value != #Legacy };
  public func removalEnabled(value : Mode) : Bool { value == #Rehearsal or value == #ProductionRemoval };
  public func valid(value : Mode) : Bool { value != #Invalid };
}