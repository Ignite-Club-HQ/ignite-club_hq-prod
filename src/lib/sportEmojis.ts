// Sport emoji mapping for consistent display across the app
export const SPORT_EMOJIS: Record<string, string> = {
  "AFL": "🏈",
  "Basketball": "🏀",
  "Cricket": "🏏",
  "Football (Soccer)": "⚽",
  "Hockey": "🏑",
  "Netball": "🏐",
  "Rugby League": "🏉",
  "Rugby Union": "🏉",
  "Swimming": "🏊",
  "Tennis": "🎾",
  "Volleyball": "🏐",
  "Other": "🎯",
};

export function getSportEmoji(sport: string | null | undefined): string {
  if (!sport) return "🏆";
  
  // Direct match
  if (SPORT_EMOJIS[sport]) {
    return SPORT_EMOJIS[sport];
  }
  
  // Case-insensitive partial match
  const lowerSport = sport.toLowerCase();
  
  if (lowerSport.includes("afl") || lowerSport.includes("aussie rules")) return "🏈";
  if (lowerSport.includes("basketball")) return "🏀";
  if (lowerSport.includes("cricket")) return "🏏";
  if (lowerSport.includes("soccer") || lowerSport.includes("football") || lowerSport.includes("futsal")) return "⚽";
  if (lowerSport.includes("hockey")) return "🏑";
  if (lowerSport.includes("netball")) return "🏐";
  if (lowerSport.includes("rugby")) return "🏉";
  if (lowerSport.includes("swim")) return "🏊";
  if (lowerSport.includes("tennis")) return "🎾";
  if (lowerSport.includes("volleyball")) return "🏐";
  
  return "🎯"; // Default for unknown sports
}
