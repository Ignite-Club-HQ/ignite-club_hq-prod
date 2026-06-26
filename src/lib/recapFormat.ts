/**
 * Strip machine-style `[YYYY-MM-DD HH:MM]` prefixes from AI-generated recap
 * bullets. The UI already groups items under "Today / Yesterday / Earlier"
 * headers, so repeating the full date on every line is noisy.
 */
export function stripRecapDatePrefix(text: string): string {
  if (!text) return text;
  return text.replace(/^\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\]\s*/, "").trim();
}
