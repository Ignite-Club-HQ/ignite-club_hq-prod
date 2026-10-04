/** Finals metadata uses the existing match notes field, including generated finals. */
export function getCompetitionFinalsLabel(value?: string | null): string | null {
  const label = value?.split("·")[0].trim();
  return label && /\bfinals?\b/i.test(label) ? label : null;
}