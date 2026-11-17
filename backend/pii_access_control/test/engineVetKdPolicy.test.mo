import VetKd "../src/EngineVetKd";
import Principal "mo:core/Principal";
let p = Principal.fromText("ynolw-eyaaa-aaaaj-qspkq-cai");
assert VetKd.select(#Direct, null) == null;
assert VetKd.select(#Proxy p, ?"ynolw-eyaaa-aaaaj-qspkq-cai") == ?p;