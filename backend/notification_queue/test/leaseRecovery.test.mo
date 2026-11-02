import Protection "../../shared/AccountProtection";

// Existing legacy recovery remains available only for unfenced work.
assert Protection.canRecoverLease(#Legacy, false);
// A retained account/erasure fence survives configuration being switched off.
assert not Protection.canRecoverLease(#Legacy, true);
// Both real production protection and rehearsal retain external obligations.
assert not Protection.canRecoverLease(#Rehearsal, false);
assert not Protection.canRecoverLease(#ProductionAdmission, false);
assert not Protection.canRecoverLease(#ProductionRemoval, false);
assert not Protection.canRecoverLease(#Invalid, false);