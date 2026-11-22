import Policy "../src/roleGrantPolicy";

assert not Policy.canGrant(false, "app_admin", null);
assert not Policy.canGrant(false, "app_admin", ?"team");
assert Policy.canGrant(true, "app_admin", null);
assert not Policy.canGrant(true, "app_admin", ?"team");
assert not Policy.platform("app_admin", ?"club", null);
assert not Policy.platform("app_admin", null, ?"team");
assert Policy.platform("app_admin", null, null);
assert Policy.canGrant(false, "club_admin", null);
assert Policy.canGrant(false, "coach", ?"team");
assert Policy.canGrant(false, "coach", null);
assert Policy.canGrant(false, "parent", ?"team");
assert not Policy.canGrant(false, "club_admin", ?"team");
assert not Policy.canGrant(false, "invented_role", null);