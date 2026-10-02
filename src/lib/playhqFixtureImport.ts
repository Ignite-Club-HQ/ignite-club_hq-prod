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

  // PlayHQ lists multi-day matches (e.g. "Two Day" games) as one row per day,
  // all sharing the same Game ID. Group those rows so each match imports once,
  // using the first day's date and start time.
  const parseDate = (d: string): number => {
    const m = d.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (m) {
      const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      return new Date(y, Number(m[2]) - 1, Number(m[1])).getTime();
    }
    const t = new Date(d).getTime();
    return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
  };

  const outRows: string[][] = [];
  const seenMatches = new Set<string>();
  const sortedRows = [...rows].sort((r1, r2) => parseDate(get(r1, "game date")) - parseDate(get(r2, "game date")));

  for (const row of sortedRows) {
    const home = get(row, "home team");
    const away = get(row, "away team");
    const bye = get(row, "bye");
    const status = get(row, "game status").toLowerCase();
    if (!home || !away || bye || status === "cancelled" || status === "forfeit") continue;

    const matchKey =
      get(row, "game id") ||
      get(row, "game code") ||
      `${home.toLowerCase()}|${away.toLowerCase()}|${get(row, "round").toLowerCase()}`;
    if (seenMatches.has(matchKey)) continue;
    seenMatches.add(matchKey);

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
