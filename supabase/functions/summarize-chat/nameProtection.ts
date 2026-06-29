// Pure helpers for sponsor protection + pseudonym map building.
// Extracted so we can unit-test the rules independently of the edge runtime.
//
// Rules under test:
//   * Sponsor display names (e.g. "Pimento Pizza") are NEVER pseudonymised,
//     even if a child / adult shares a token with them.
//   * A child / adult FIRST name is only added to the swap map when it is
//     >= 4 characters AND not a sponsor token — this stops short names like
//     "Pip" / "Bea" colliding with everyday words or substrings.
//   * Replacement uses word boundaries so "Pip" never matches inside "Pippa"
//     or "Pipeline".

export type AuthorInput = { id: string; name: string };
export type ChildInput = { name: string; parentName?: string };

export const normaliseToken = (raw: string): string =>
  raw.toLowerCase().replace(/[^a-z0-9]/g, "");

export const buildProtectedTokens = (sponsorNames: string[]): Set<string> => {
  const out = new Set<string>();
  for (const raw of sponsorNames) {
    const n = (raw || "").trim();
    if (!n) continue;
    for (const word of n.split(/\s+/)) {
      const t = normaliseToken(word);
      if (t.length >= 2) out.add(t);
    }
  }
  return out;
};

export const isProtectedName = (
  name: string,
  protectedTokens: Set<string>,
): boolean => {
  const t = normaliseToken(name);
  return !!t && protectedTokens.has(t);
};

export interface PseudonymMaps {
  pseudoByRealName: Map<string, string>;
  realByPseudo: Map<string, string>;
  protectedTokens: Set<string>;
}

export const buildPseudonymMaps = (input: {
  authors: AuthorInput[];
  sponsors: string[];
  children: ChildInput[];
}): PseudonymMaps => {
  const protectedTokens = buildProtectedTokens(input.sponsors);
  const pseudoByRealName = new Map<string, string>();
  const realByPseudo = new Map<string, string>();
  let personCounter = 0;

  const getPseudo = (real: string): string => {
    const key = real.trim();
    if (!key) return "Someone";
    const existing = pseudoByRealName.get(key);
    if (existing) return existing;
    personCounter += 1;
    const p = `Person ${personCounter}`;
    pseudoByRealName.set(key, p);
    realByPseudo.set(p, key);
    return p;
  };

  // Seed adult full-name -> Person N.
  for (const a of input.authors) {
    const n = (a.name || "").trim();
    if (n) getPseudo(n);
  }

  // Children -> Child N, with rehydrate target "<ParentFirst>'s child".
  for (const k of input.children) {
    const n = (k.name || "").trim();
    if (!n) continue;
    const parentFull = (k.parentName || "").trim();
    const parentFirst = parentFull.split(/\s+/)[0] || "";
    const descriptor = parentFirst ? `${parentFirst}'s child` : "a child";
    if (!pseudoByRealName.has(n) && !isProtectedName(n, protectedTokens)) {
      personCounter += 1;
      const p = `Child ${personCounter}`;
      pseudoByRealName.set(n, p);
      realByPseudo.set(p, descriptor);
    }
    const first = n.split(/\s+/)[0];
    if (
      first &&
      first.length >= 4 &&
      !isProtectedName(first, protectedTokens) &&
      !pseudoByRealName.has(first) &&
      pseudoByRealName.has(n)
    ) {
      pseudoByRealName.set(first, pseudoByRealName.get(n)!);
    }
  }

  // Adult first-name aliases (Sarah -> the Person N already assigned to "Sarah Lee").
  for (const a of input.authors) {
    const full = (a.name || "").trim();
    const first = full.split(/\s+/)[0];
    if (
      first &&
      first.length >= 4 &&
      !isProtectedName(first, protectedTokens) &&
      !pseudoByRealName.has(first) &&
      pseudoByRealName.has(full)
    ) {
      pseudoByRealName.set(first, pseudoByRealName.get(full)!);
    }
  }

  return { pseudoByRealName, realByPseudo, protectedTokens };
};

const escapeRe = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const applyPseudonyms = (
  text: string,
  pseudoByRealName: Map<string, string>,
): string => {
  let out = text;
  // Longest first so "Sarah Lee" wins over "Sarah".
  const names = Array.from(pseudoByRealName.keys()).sort(
    (a, b) => b.length - a.length,
  );
  for (const name of names) {
    if (name.length < 2) continue;
    const re = new RegExp(`\\b${escapeRe(name)}\\b`, "gi");
    out = out.replace(re, pseudoByRealName.get(name)!);
  }
  return out;
};

export const rehydratePseudonyms = (
  text: string,
  realByPseudo: Map<string, string>,
): string => {
  if (!text) return text;
  let out = text;
  const pseudos = Array.from(realByPseudo.keys()).sort(
    (a, b) => b.length - a.length,
  );
  for (const p of pseudos) {
    const re = new RegExp(`\\b${escapeRe(p)}\\b`, "g");
    out = out.replace(re, realByPseudo.get(p)!);
  }
  out = out.replace(/\bChild\s+\d+\b/gi, "a child");
  out = out.replace(/\b(?:Person|Player|Member|Parent|Coach|Volunteer|User|Speaker)\s+\d+\b/gi, "someone");
  return out;
};
