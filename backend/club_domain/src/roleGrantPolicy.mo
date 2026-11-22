module {
  public func platform(role : Text, club : ?Text, team : ?Text) : Bool {
    role == "app_admin" and club == null and team == null
  };
  public func canGrant(governor : Bool, role : Text, team : ?Text) : Bool {
    if (role == "app_admin") return governor and team == null;
    if (team != null) return role == "player" or role == "parent" or role == "coach" or role == "team_admin";
    role == "club_admin" or role == "member" or role == "basic_user" or role == "player" or role == "parent" or role == "coach" or role == "committee_member" or role == "committee" or role == "league_admin" or role == "association_admin" or role == "competition_admin"
  };
}