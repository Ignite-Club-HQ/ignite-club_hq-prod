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

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const pad = (n: number | string) => String(n).padStart(2, "0");
const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/**
 * PlayHQ multi-day matches can put several dates in one cell, e.g.
 * "17/10/2026, 18/10/2026", "17/10/2026 - 18/10/2026", "17-18/10/2026",
 * "Sat 17 Oct 2026 & Sun 18 Oct 2026" or one date per line. Excel cells may
 * also arrive as ISO strings or serial numbers. Returns the FIRST (start)
 * date as dd/mm/yyyy, or the original text if nothing recognisable is found.
 */
export function normalisePlayHQDate(raw: string): string {
  const v = (raw || "").trim();
  if (!v) return "";
  // Excel serial date number (days since 1899-12-30)
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86400000);
    return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  }
  // ISO yyyy-mm-dd (Excel Date cells are passed through as ISO)
  let m = v.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${pad(m[3])}/${pad(m[2])}/${m[1]}`;
  // Day range sharing month/year: "17-18/10/2026" or "17 & 18/10/2026"
  m = v.match(/^(\d{1,2})\s*(?:-|–|&|and|,)\s*\d{1,2}[\/.](\d{1,2})[\/.](\d{2,4})/i);
  if (m) return `${pad(m[1])}/${pad(m[2])}/${fullYear(m[3])}`;
  // Numeric dd/mm/yyyy (also . or - separators) — take the first one
  m = v.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (m) return `${pad(m[1])}/${pad(m[2])}/${fullYear(m[3])}`;
  // First date without a year, year taken from later in the cell: "17/10 - 18/10/2026"
  m = v.match(/(\d{1,2})[\/.](\d{1,2})(?![\/.\d])/);
  const y = v.match(/\b(20\d{2})\b/);
  if (m && y) return `${pad(m[1])}/${pad(m[2])}/${y[1]}`;
  // Month names: "17 Oct 2026", "Sat 17 October 2026", "17-18 Oct 2026"
  m = v.match(/(\d{1,2})(?:st|nd|rd|th)?(?:\s*(?:-|–|&|and)\s*\d{1,2}(?:st|nd|rd|th)?)?\s+([a-z]{3,9})\.?,?\s*(\d{4})?/i);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
    const year = m[3] || y?.[1];
    if (mon && year) return `${pad(m[1])}/${pad(mon)}/${year}`;
  }
  // "October 17, 2026"
  m = v.match(/([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})/i);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon) return `${pad(m[2])}/${pad(mon)}/${m[3]}`;
  }
  return v;
}

/** First start time in the cell as HH:MM ("09:00, 10:30", "9:30am", ISO, Excel fraction). */
export function normalisePlayHQTime(raw: string): string {
  const v = (raw || "").trim();
  if (!v) return "";
  if (/^0?\.\d+$/.test(v)) {
    const mins = Math.round(Number(v) * 1440);
    return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
  }
  const iso = v.match(/T(\d{2}):(\d{2})/);
  if (iso) return `${iso[1]}:${iso[2]}`;
  const m = v.match(/(\d{1,2})[:.](\d{2})\s*(am|pm)?/i) || v.match(/\b(\d{1,2})()\s*(am|pm)\b/i);
  if (m) {
    let h = Number(m[1]);
    const ap = (m[3] || "").toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return `${pad(h)}:${pad(m[2] || "00")}`;
  }
  const compact = v.match(/^(\d{3,4})$/);
  if (compact) return `${pad(compact[1].slice(0, -2))}:${compact[1].slice(-2)}`;
  return v;
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
  const parseDate = (raw: string): number => {
    const d = normalisePlayHQDate(raw);
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
      normalisePlayHQDate(get(row, "game date")),
      normalisePlayHQTime(get(row, "time")),
      venue,
      surface && surface.toLowerCase() !== venue.toLowerCase() ? surface : "",
      grade,
      h.club, home, h.group,
      a.club, away, a.group,
    ]);
  }
  return { headers: outHeaders, rows: outRows };
}
