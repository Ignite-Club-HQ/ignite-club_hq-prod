// Phase 1 — Unified Recipient Input parser
// Accepts pasted text and extracts a list of recipients.
// Supported formats per entry (separated by , ; \n \t):
//   "Alex Smith"
//   "alex@example.com"
//   "Alex Smith <alex@example.com>"
//   "Alex Smith, alex@example.com"  (when whole input is a single recipient)

export interface ParsedRecipient {
  name: string;
  email: string;
}

const EMAIL_RE = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;

function parseEntry(raw: string): ParsedRecipient | null {
  const s = raw.trim().replace(/^["']|["']$/g, "");
  if (!s) return null;

  // "Name <email>"
  const angle = s.match(/^(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (angle) {
    const name = angle[1].trim();
    const email = angle[2].trim();
    if (EMAIL_RE.test(email)) return { name: name || email.split("@")[0], email };
  }

  // Bare email
  const emailMatch = s.match(EMAIL_RE);
  if (emailMatch && s.replace(emailMatch[0], "").trim().length === 0) {
    return { name: emailMatch[0].split("@")[0], email: emailMatch[0] };
  }

  // "Name email" or "Name, email"
  if (emailMatch) {
    const name = s.replace(emailMatch[0], "").replace(/[,;]/g, " ").trim();
    return { name: name || emailMatch[0].split("@")[0], email: emailMatch[0] };
  }

  // Name only
  return { name: s, email: "" };
}

export function parseRecipients(input: string): ParsedRecipient[] {
  if (!input) return [];
  // Split on newlines, tabs, semicolons. Commas only split when input contains
  // a separator that strongly suggests a list (newline / tab / semicolon, or
  // multiple emails) — otherwise "Alex Smith, alex@x.com" is one entry.
  const hasStrongSep = /[\n\t;]/.test(input);
  const emailCount = (input.match(/@/g) ?? []).length;
  const splitRe = hasStrongSep || emailCount > 1 ? /[\n\t;,]+/ : /[\n\t;]+/;
  const parts = input.split(splitRe).map((p) => p.trim()).filter(Boolean);
  const out: ParsedRecipient[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const r = parseEntry(p);
    if (!r) continue;
    const key = (r.email || r.name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// Heuristic: does the pasted text look like a multi-recipient list?
export function looksLikeMultiRecipient(input: string): boolean {
  if (!input) return false;
  if (/[\n\t;]/.test(input)) {
    return parseRecipients(input).length >= 2;
  }
  const emails = input.match(/@/g) ?? [];
  if (emails.length >= 2) return parseRecipients(input).length >= 2;
  return false;
}
