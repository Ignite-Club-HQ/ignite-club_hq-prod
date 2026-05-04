/**
 * Abbreviate common long location-name suffixes so cards stay scannable.
 * Display-only — the underlying data is unchanged.
 *
 *   "Bridgewater Primary School"  → "Bridgewater PS"
 *   "St Marys Secondary College"  → "St Marys SC"
 *   "Greenwood High School"       → "Greenwood HS"
 *
 * If no rule matches, the original string is returned unchanged so CSS
 * truncation can take over for very long one-off names.
 */
const SUFFIX_RULES: Array<{ re: RegExp; replace: string }> = [
  { re: /\bPrimary\s+School\b/i, replace: "PS" },
  { re: /\bSecondary\s+College\b/i, replace: "SC" },
  { re: /\bSecondary\s+School\b/i, replace: "SS" },
  { re: /\bHigh\s+School\b/i, replace: "HS" },
  { re: /\bRecreation\s+Centre\b/i, replace: "Rec Centre" },
  { re: /\bRecreation\s+Center\b/i, replace: "Rec Center" },
  { re: /\bSports\s+Centre\b/i, replace: "Sports Ctr" },
  { re: /\bSports\s+Center\b/i, replace: "Sports Ctr" },
  { re: /\bCommunity\s+Centre\b/i, replace: "Community Ctr" },
  { re: /\bCommunity\s+Center\b/i, replace: "Community Ctr" },
];

export function abbreviateLocation(name?: string | null): string {
  if (!name) return "";
  let out = name.trim();
  for (const { re, replace } of SUFFIX_RULES) {
    if (re.test(out)) {
      out = out.replace(re, replace);
      break;
    }
  }
  return out;
}
