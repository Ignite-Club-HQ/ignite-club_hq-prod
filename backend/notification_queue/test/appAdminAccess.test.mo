import Principal "mo:core/Principal";
import Error "mo:core/Error";
import Access "../src/appAdminAccess";

let admin = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
let member = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
let run = async {
  var legacyCalls = 0;
  var protectedCalls = 0;
  func legacy(p : Principal) : async Bool { legacyCalls += 1; p == admin };
  func protectedRead(p : Principal) : async Bool { protectedCalls += 1; p == admin };
  func unavailable(_ : Principal) : async Bool { protectedCalls += 1; throw Error.reject("Method not found") };
  assert (await Access.authorize(admin, false, legacy, unavailable)) == #Ok;
  assert legacyCalls == 1 and protectedCalls == 0;
  assert (await Access.authorize(admin, true, legacy, protectedRead)) == #Ok;
  assert legacyCalls == 1 and protectedCalls == 1;
  assert (await Access.authorize(member, false, legacy, protectedRead)) == #Err("App admin required");
  assert (await Access.authorize(admin, true, legacy, unavailable)) == #Err("App admin verification unavailable");
  assert legacyCalls == 2;
  assert (await Access.authorize(Principal.anonymous(), false, legacy, protectedRead)) == #Err("App admin required");
  assert legacyCalls == 2 and protectedCalls == 2;
  // Bounded-wait unknown replies must refuse, never try the legacy reader.
  func unknown(_ : Principal) : async Bool { throw Error.reject("SYS_UNKNOWN") };
  assert (await Access.authorize(admin, true, legacy, unknown)) == #Err("App admin verification unavailable");
  assert legacyCalls == 2;
};