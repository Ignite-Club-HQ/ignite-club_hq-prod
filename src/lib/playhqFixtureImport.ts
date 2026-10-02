/**
 * PlayHQ "advanced fixture" export support (used by cricket associations).
 * Rows are converted into the same shape the Dribl team mapper consumes, so
 * the existing mapping / preview / import flow is reused unchanged.
 */

export function isPlayHQFormat(headers: string[]): boolean {
  const h = headers.map((x) => x.toLowerCase().trim());
  const needed = ["game date", "home team", "away team", "playing surface", "grade"];
  return needed.filter((n) => h.includes(n)).length >= 4;
}

const GRADE_RE = /\b(u\s?\d{1,2}|under\s?\d{1,2}|open|senior|a\s?grade|b\s?grade|c\s?grade)\b/i;

/** "Stirling U12 White" -> { club: "Stirling", grade: "U12", group: "White" } */
export function splitPlayHQTeam(name: string): { club: string; grade: string; group: string } {
  const n = (name || "").trim();
  const m = n.match(/^(.*?)\s+(U\s?\d{1,2}|Under\s?\d{1,2})\b\s*(.*)$/i);
  if (m) return { club: m[1].trim(), grade: m[2].replace(/\s+/g, "").toUpperCase(), group: m[3].trim() };
  return { club: n, grade: "", group: "" };
}

export function playHQToDriblShape(headers: string[], rows: string[][]): { headers: string[]; rows: string[][] } {
  const idx = (name: string) => headers.findIndex((x) => x.toLowerCase().trim() === name);
  const get = (row: string[], name: string) => {
    const i = idx(name);
    return i >= 0 ? (row[i] ?? "").toString().trim() : "";
  };

  const outHeaders = [
    "Identifier", "Competition", "Round", "Date", "Start", "Ground", "Field",
    "Age Group", "Home Club Name", "Home Team", "Home Team Group",
    "Away Club Name", "Away Team", "Away Team Group",
  ];

  const outRows: string[][] = [];
  for (const row of rows) {
    const home = get(row, "home team");
    const away = get(row, "away team");
    const bye = get(row, "bye");
    const status = get(row, "game status").toLowerCase();
    if (!home || !away || bye || status === "cancelled" || status === "forfeit") continue;

    const h = splitPlayHQTeam(home);
    const a = splitPlayHQTeam(away);
    const gradeCol = get(row, "grade");
    const grade = h.grade || a.grade || (gradeCol.match(GRADE_RE)?.[0] ?? gradeCol);
    const venue = get(row, "venue");
    const surface = get(row, "playing surface");

    outRows.push([
      get(row, "game id") || get(row, "game code"),
      [get(row, "competition"), gradeCol].filter(Boolean).join(" - "),
      get(row, "round"),
      get(row, "game date"),
      get(row, "time"),
      venue,
      surface && surface.toLowerCase() !== venue.toLowerCase() ? surface : "",
      grade,
      h.club, home, h.group,
      a.club, away, a.group,
    ]);
  }
  return { headers: outHeaders, rows: outRows };
}
