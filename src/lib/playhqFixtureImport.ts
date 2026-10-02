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
  // Numeric dd/mm[/yyyy] — take the first one; if it has no year, use the
  // year that appears later in the cell ("17/10 - 18/10/2026").
  const y = v.match(/\b(20\d{2})\b/);
  m = v.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})|(\d{1,2})[\/.](\d{1,2})(?![\/.\d])/);
  if (m && m[1]) return `${pad(m[1])}/${pad(m[2])}/${fullYear(m[3])}`;
  if (m && m[4] && y) return `${pad(m[4])}/${pad(m[5])}/${y[1]}`;
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

const VALID_DATE = /^\d{2}\/\d{2}\/\d{4}$/;
const PIECE_SPLIT = /\s*(?:,|;|\n|&|\band\b|\bto\b|\s[-–]\s|\|)\s*/i;

/**
 * Every date in a cell, as dd/mm/yyyy, in order. Handles
 * "17/10/2026, 18/10/2026", "17/10/2026 - 18/10/2026", "17-18/10/2026",
 * "17-18 Oct 2026", "17/10 - 18/10/2026", one date per line, etc.
 */
export function extractPlayHQDates(raw: string): string[] {
  const v = (raw || "").trim();
  if (!v) return [];
  const toDate = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  const dayRange = (from: number, to: number, mon: number, year: number) => {
    const out: string[] = [];
    // "31-1/11/2026": the month/year belong to the last day.
    const start = to >= from ? new Date(year, mon - 1, from) : new Date(year, mon - 2, from);
    const end = new Date(year, mon - 1, to);
    for (let d = start; d <= end && out.length < 7; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) out.push(toDate(d));
    return out;
  };
  // "17-18/10/2026"
  let m = v.match(/^(\d{1,2})\s*[-–&]\s*(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})$/);
  if (m) return dayRange(Number(m[1]), Number(m[2]), Number(m[3]), fullYear(m[4]));
  // "17-18 Oct 2026" / "Sat 17 - Sun 18 October 2026"
  m = v.match(/^(?:[a-z]{3,9}\s+)?(\d{1,2})(?:st|nd|rd|th)?\s*[-–&]\s*(?:[a-z]{3,9}\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})$/i);
  if (m) {
    const mon = MONTHS[m[3].slice(0, 4).toLowerCase()] ?? MONTHS[m[3].slice(0, 3).toLowerCase()];
    if (mon) return dayRange(Number(m[1]), Number(m[2]), mon, Number(m[4]));
  }
  const year = v.match(/\b(20\d{2})\b/)?.[1];
  const pieces = v.split(PIECE_SPLIT).filter(Boolean);
  const dates: string[] = [];
  for (const piece of pieces) {
    const withYear = year && !/\b\d{4}\b/.test(piece) && !/\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2}\b/.test(piece) ? `${piece} ${year}` : piece;
    const d = normalisePlayHQDate(withYear);
    if (VALID_DATE.test(d) && !dates.includes(d)) dates.push(d);
  }
  if (dates.length >= 2) return dates;
  const single = normalisePlayHQDate(v);
  return [single];
}

/** Every start time in a cell, as HH:MM, in order ("10:00, 10:00" -> ["10:00","10:00"]). */
export function extractPlayHQTimes(raw: string): string[] {
  const v = (raw || "").trim();
  if (!v) return [];
  const pieces = v.split(/\s*(?:,|;|\n|&|\band\b|\s[-–\/]\s|\|)\s*/i).filter(Boolean);
  const times = pieces.map(normalisePlayHQTime).filter((t) => /^\d{2}:\d{2}$/.test(t));
  return times.length ? times : [normalisePlayHQTime(v)];
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

  // Multi-day matches (e.g. two-day cricket) arrive either as one row per day
  // sharing the same Game ID, or as one row with several dates in the cell.
  // Every playing day becomes its own fixture ("Round 1 (Day 1 of 2)") so
  // each day lands on the schedule.
  const dateValue = (d: string): number => {
    const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime() : Number.MAX_SAFE_INTEGER;
  };

  type Match = { row: string[]; days: Map<string, string> };
  const matches = new Map<string, Match>();
  const order: string[] = [];

  for (const row of rows) {
    const home = get(row, "home team");
    const away = get(row, "away team");
    const bye = get(row, "bye");
    const status = get(row, "game status").toLowerCase();
    if (!home || !away || bye || status === "cancelled" || status === "forfeit") continue;

    const matchKey =
      get(row, "game id") ||
      get(row, "game code") ||
      `${home.toLowerCase()}|${away.toLowerCase()}|${get(row, "round").toLowerCase()}`;
    let match = matches.get(matchKey);
    if (!match) {
      match = { row, days: new Map() };
      matches.set(matchKey, match);
      order.push(matchKey);
    }
    const dates = extractPlayHQDates(get(row, "game date"));
    const times = extractPlayHQTimes(get(row, "time"));
    dates.forEach((d, i) => {
      if (!match!.days.has(d)) match!.days.set(d, times[i] ?? times[0] ?? "");
      else if (!match!.days.get(d) && (times[i] ?? times[0])) match!.days.set(d, times[i] ?? times[0]);
    });
    if (dates.length === 0 && !match.days.has("")) match.days.set("", times[0] ?? "");
  }

  const outRows: string[][] = [];
  for (const key of order) {
    const { row, days } = matches.get(key)!;
    const home = get(row, "home team");
    const away = get(row, "away team");
    const h = splitPlayHQTeam(home);
    const a = splitPlayHQTeam(away);
    const gradeCol = get(row, "grade");
    const grade = h.grade || a.grade || (gradeCol.match(GRADE_RE)?.[0] ?? gradeCol);
    const venue = get(row, "venue");
    const surface = get(row, "playing surface");
    const id = get(row, "game id") || get(row, "game code");
    const round = get(row, "round");

    const dayList = [...days.entries()].sort((x, y) => dateValue(x[0]) - dateValue(y[0]));
    // A later day with no time listed starts at the same time as the first day.
    const fallbackTime = dayList.find(([, t]) => t)?.[1] ?? "";
    for (const d of dayList) if (!d[1]) d[1] = fallbackTime;
    dayList.forEach(([date, time], i) => {
      const multi = dayList.length > 1;
      const dayLabel = multi ? `Day ${i + 1} of ${dayList.length}` : "";
      outRows.push([
        multi && id ? `${id}#day${i + 1}` : id,
        [get(row, "competition"), gradeCol].filter(Boolean).join(" - "),
        multi ? (round ? `${round} (${dayLabel})` : dayLabel) : round,
        date,
        time,
        venue,
        surface && surface.toLowerCase() !== venue.toLowerCase() ? surface : "",
        grade,
        h.club, home, h.group,
        a.club, away, a.group,
      ]);
    });
  }
  outRows.sort((r1, r2) => dateValue(r1[3]) - dateValue(r2[3]));
  return { headers: outHeaders, rows: outRows };
}
