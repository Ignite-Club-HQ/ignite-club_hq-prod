// Deno tests for sponsor-name protection + first-name word-boundary rules.
// Run with: supabase test edge-functions (or `deno test --allow-env --allow-net`).
import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyPseudonyms,
  buildProtectedTokens,
  buildPseudonymMaps,
  isProtectedName,
  rehydratePseudonyms,
} from "./nameProtection.ts";

Deno.test("buildProtectedTokens lowercases sponsor words and ignores 1-char tokens", () => {
  const tokens = buildProtectedTokens(["Pimento Pizza", "A Co", "  "]);
  assert(tokens.has("pimento"));
  assert(tokens.has("pizza"));
  assert(tokens.has("co"));
  // single-letter "a" is dropped (len < 2)
  assert(!tokens.has("a"));
});

Deno.test("isProtectedName matches case- and punctuation-insensitively", () => {
  const tokens = buildProtectedTokens(["Pimento Pizza"]);
  assert(isProtectedName("pimento", tokens));
  assert(isProtectedName("PIMENTO", tokens));
  assert(isProtectedName("Pimento!", tokens));
  assert(!isProtectedName("Pim", tokens));
});

Deno.test("sponsor token is never pseudonymised even when a child shares the name", () => {
  // A child literally named "Pimento" must not steal the sponsor token.
  const { pseudoByRealName } = buildPseudonymMaps({
    authors: [{ id: "a1", name: "Renee Smith" }],
    sponsors: ["Pimento Pizza"],
    children: [{ name: "Pimento", parentName: "Renee Smith" }],
  });
  assertEquals(pseudoByRealName.has("Pimento"), false);

  const transcript = "Pimento Pizza paid $500 sponsorship.";
  const out = applyPseudonyms(transcript, pseudoByRealName);
  assertEquals(out, "Pimento Pizza paid $500 sponsorship.");
});

Deno.test("short child first names (< 4 chars) do NOT alias — no collision with everyday words", () => {
  // "Pip" must not become "Child N" inside "Pipeline" or "Pippa".
  const { pseudoByRealName } = buildPseudonymMaps({
    authors: [{ id: "a1", name: "Jo Brown" }],
    sponsors: [],
    children: [{ name: "Pip Brown", parentName: "Jo Brown" }],
  });
  // Full name is mapped...
  assert(pseudoByRealName.has("Pip Brown"));
  // ...but the bare first name "Pip" is NOT (length < 4).
  assert(!pseudoByRealName.has("Pip"));

  const out = applyPseudonyms("The pipeline runs past Pippa's house.", pseudoByRealName);
  assertEquals(out, "The pipeline runs past Pippa's house.");
});

Deno.test("adult first names >= 4 chars alias to the same pseudonym", () => {
  const { pseudoByRealName } = buildPseudonymMaps({
    authors: [{ id: "a1", name: "Sarah Lee" }],
    sponsors: [],
    children: [],
  });
  assertEquals(pseudoByRealName.get("Sarah"), pseudoByRealName.get("Sarah Lee"));

  const out = applyPseudonyms("Hi Sarah, thanks!", pseudoByRealName);
  assert(/Hi Person 1, thanks!/.test(out));
});

Deno.test("first-name alias is skipped when it collides with a sponsor token", () => {
  // Sponsor "Pimento Pizza" + adult "Pimento Jones" — adult's first name
  // must NOT be added to the swap map (would corrupt sponsor mentions).
  const { pseudoByRealName } = buildPseudonymMaps({
    authors: [{ id: "a1", name: "Pimento Jones" }],
    sponsors: ["Pimento Pizza"],
    children: [],
  });
  // Full name still mapped (so "Pimento Jones" gets pseudonymised in text)...
  assert(pseudoByRealName.has("Pimento Jones"));
  // ...but bare "Pimento" must remain untouched so sponsor mentions survive.
  assert(!pseudoByRealName.has("Pimento"));

  const text = "Pimento Pizza donated. Pimento Jones thanked them.";
  const out = applyPseudonyms(text, pseudoByRealName);
  assertEquals(out, "Pimento Pizza donated. Person 1 thanked them.");
});

Deno.test("word-boundary replacement does not match substrings", () => {
  const { pseudoByRealName } = buildPseudonymMaps({
    authors: [{ id: "a1", name: "Sarah Lee" }],
    sponsors: [],
    children: [],
  });
  const out = applyPseudonyms("Sarahsburg is not Sarah.", pseudoByRealName);
  // "Sarahsburg" stays intact; standalone "Sarah" is swapped.
  assert(out.includes("Sarahsburg"));
  assert(/\bPerson 1\.\s*$/.test(out));
});

Deno.test("rehydrate maps Child N back to '<Parent>'s child' and Person N back to real name", () => {
  const { pseudoByRealName, realByPseudo } = buildPseudonymMaps({
    authors: [{ id: "a1", name: "Renee Smith" }],
    sponsors: ["Pimento Pizza"],
    children: [{ name: "Archer Smith", parentName: "Renee Smith" }],
  });
  const pseudonymised = applyPseudonyms(
    "Renee Smith said Archer Smith is unavailable. Pimento Pizza paid.",
    pseudoByRealName,
  );
  const rehydrated = rehydratePseudonyms(pseudonymised, realByPseudo);
  assertEquals(
    rehydrated,
    "Renee Smith said Renee's child is unavailable. Pimento Pizza paid.",
  );
});

Deno.test("rehydrate safety-net: unseen Child N / Person N degrade to neutral descriptors", () => {
  const { realByPseudo } = buildPseudonymMaps({
    authors: [{ id: "a1", name: "Jo Brown" }],
    sponsors: [],
    children: [],
  });
  const out = rehydratePseudonyms("Child 9 helped Person 17 today.", realByPseudo);
  assertEquals(out, "a child helped someone today.");
});
