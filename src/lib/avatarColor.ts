// Deterministic avatar gradient + initial from a display name.
// Used by chat avatar fallbacks (ChatMessage, GroupChatMessageRow) so
// initials-based avatars feel intentional and personal — every member
// gets the same colour every time, across DMs / team / group chats.

const PALETTES: Array<{ from: string; to: string; fg: string }> = [
  { from: "#FF6B6B", to: "#EE5A6F", fg: "#ffffff" }, // coral
  { from: "#F59E0B", to: "#F97316", fg: "#ffffff" }, // amber
  { from: "#10B981", to: "#059669", fg: "#ffffff" }, // emerald
  { from: "#06B6D4", to: "#0EA5E9", fg: "#ffffff" }, // cyan
  { from: "#3B82F6", to: "#6366F1", fg: "#ffffff" }, // indigo
  { from: "#8B5CF6", to: "#A855F7", fg: "#ffffff" }, // violet
  { from: "#EC4899", to: "#D946EF", fg: "#ffffff" }, // pink
  { from: "#14B8A6", to: "#22C55E", fg: "#ffffff" }, // teal-green
  { from: "#EAB308", to: "#F59E0B", fg: "#1f1300" }, // gold
  { from: "#64748B", to: "#475569", fg: "#ffffff" }, // slate
];

function hash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function getAvatarPalette(name?: string | null) {
  const seed = (name || "?").trim().toLowerCase() || "?";
  return PALETTES[hash(seed) % PALETTES.length];
}

export function getAvatarInitial(name?: string | null): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return "?";
  // First letter of first word; fall back to first char.
  return (trimmed[0] || "?").toUpperCase();
}

export function getAvatarFallbackStyle(
  name?: string | null,
): React.CSSProperties {
  const { from, to, fg } = getAvatarPalette(name);
  return {
    backgroundImage: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
    color: fg,
  };
}
