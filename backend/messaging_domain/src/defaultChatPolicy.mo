import Text "mo:core/Text";
module {
  public func name(key : Text) : ?Text {
    switch (key) {
      case "coaches" ?"Coaches";
      case "team_admins" ?"Team Admins";
      case "club_committee" ?"Club Committee";
      case _ null;
    }
  };
  public func keys() : [Text] { ["coaches", "team_admins", "club_committee"] };
  public func identity(club : Text, key : Text) : Text {
    "default-club-chat:" # club # ":" # key
  };
}