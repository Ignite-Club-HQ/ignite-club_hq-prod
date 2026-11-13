import Oql "../../shared/Oql";
import Types "types";
import Nat64 "mo:core/Nat64";
import SubscriptionPolicy "subscriptionPolicy";
module {
  public let entities : [Oql.Entity] = [
    { name = "clubs"; fields = [
      { name = "id"; kind = "text" }, { name = "name"; kind = "text" },
      { name = "slug"; kind = "text" }, { name = "sport"; kind = "text" }, { name = "is_active"; kind = "bool" }
    ] },
    { name = "teams"; fields = [
      { name = "id"; kind = "text" }, { name = "club_id"; kind = "text" }, { name = "name"; kind = "text" },
      { name = "division"; kind = "text" }, { name = "age_group"; kind = "text" }, { name = "is_active"; kind = "bool" }
    ] },
    // Membership-only read surface for subscriptions already fulfilled by Ignite's Stripe website.
    // No payment metadata, card details, account principals or billing identifiers.
    { name = "club_subscriptions"; fields = [
      { name = "club_id"; kind = "text" }, { name = "plan"; kind = "text" },
      { name = "is_pro"; kind = "bool" }, { name = "is_pro_football"; kind = "bool" },
      { name = "is_trial"; kind = "bool" }, { name = "trial_active"; kind = "bool" },
      { name = "premium_active"; kind = "bool" }, { name = "trial_ends_at_ms"; kind = "int" },
      { name = "expires_at_ms"; kind = "int" }
    ] },
    { name = "team_subscriptions"; fields = [
      { name = "team_id"; kind = "text" },
      { name = "is_pro"; kind = "bool" }, { name = "is_pro_football"; kind = "bool" },
      { name = "is_trial"; kind = "bool" }, { name = "trial_active"; kind = "bool" },
      { name = "premium_active"; kind = "bool" }, { name = "trial_ends_at_ms"; kind = "int" }
    ] },
    // Only this explicitly approved, public, non-secret configuration key is
    // exposed. No general app_config, reacceptance flag or policy contents.
    { name = "legal_release"; fields = [
      { name = "version"; kind = "text" },
      { name = "terms_url"; kind = "text" },
      { name = "privacy_url"; kind = "text" }
    ] }
  ];
  public func legalReleaseRow(version : Text) : Oql.Row {
    [Oql.text("version", version),
     Oql.text("terms_url", "https://igniteclubhq.com/terms"),
     Oql.text("privacy_url", "https://igniteclubhq.com/privacy")]
  };
  public func clubRow(club : Types.ClubProfile) : Oql.Row {
    [Oql.text("id", club.id), Oql.text("name", club.name), Oql.text("slug", club.slug),
     Oql.optional("sport", club.sport), Oql.boolean("is_active", club.is_active)]
  };
  public func teamRow(team : Types.ClubTeam) : Oql.Row {
    [Oql.text("id", team.id), Oql.text("club_id", team.club_id), Oql.text("name", team.name),
     Oql.optional("division", team.division), Oql.optional("age_group", team.age_group), Oql.boolean("is_active", team.is_active)]
  };
  func timestamp(name : Text, value : ?Nat64) : Oql.Cell {
    switch (value) {
      case (?ms) Oql.integer(name, Nat64.toNat(ms));
      case null { { name; value = #null_ } };
    }
  };
  public func clubSubscriptionRow(sub : Types.ClubSubscription, now : Nat64) : Oql.Row {
    let trialActive = sub.is_trial and (switch (sub.trial_ends_at_ms) {
      case (?end) end > now;
      case null false;
    });
    [Oql.text("club_id", sub.club_id), Oql.text("plan", sub.plan),
     Oql.boolean("is_pro", sub.is_pro), Oql.boolean("is_pro_football", sub.is_pro_football),
     Oql.boolean("is_trial", sub.is_trial), Oql.boolean("trial_active", trialActive),
     Oql.boolean("premium_active", SubscriptionPolicy.premium(?sub, now)),
     timestamp("trial_ends_at_ms", sub.trial_ends_at_ms),
     timestamp("expires_at_ms", sub.expires_at_ms)]
  };
  public func teamSubscriptionRow(sub : Types.TeamSubscription, now : Nat64) : Oql.Row {
    let trialActive = sub.is_trial and (switch (sub.trial_ends_at_ms) {
      case (?end) end > now;
      case null false;
    });
    [Oql.text("team_id", sub.team_id),
     Oql.boolean("is_pro", sub.is_pro), Oql.boolean("is_pro_football", sub.is_pro_football),
     Oql.boolean("is_trial", sub.is_trial), Oql.boolean("trial_active", trialActive),
     Oql.boolean("premium_active", sub.is_pro or sub.is_pro_football or sub.admin_pro_override or sub.admin_pro_football_override or trialActive),
     timestamp("trial_ends_at_ms", sub.trial_ends_at_ms)]
  };
}
