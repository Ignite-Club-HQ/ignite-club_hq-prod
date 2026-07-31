/**
 * Estate-wide deployability contracts for Supabase Edge Functions.
 *
 * This deliberately performs local, source-only validation. It never starts
 * Supabase, reads environment credentials, or contacts Deno/esm.sh imports.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const functionsRoot = path.join(root, "supabase/functions");

const entryPoints = readdirSync(functionsRoot, { withFileTypes: true })
  .filter((entry) =>
    entry.isDirectory() &&
    !entry.name.startsWith("_") &&
    existsSync(path.join(functionsRoot, entry.name, "index.ts"))
  )
  .map((entry) => ({
    name: entry.name,
    file: path.join(functionsRoot, entry.name, "index.ts"),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

function localImports(source: string): string[] {
  return [
    ...source.matchAll(
      /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/g,
    ),
  ].map((match) => match[1]);
}

function resolveLocalImport(importer: string, specifier: string): string | null {
  const candidate = path.resolve(path.dirname(importer), specifier);
  const candidates = [
    candidate,
    `${candidate}.ts`,
    `${candidate}.tsx`,
    path.join(candidate, "index.ts"),
  ];
  return candidates.find(existsSync) ?? null;
}

describe("Edge Function estate deployability", () => {
  it("discovers the complete non-shared Edge Function estate", () => {
    // A sudden drop normally means functions were moved or omitted from the
    // validation boundary. Additions are accepted and validated automatically.
    expect(entryPoints.length).toBeGreaterThanOrEqual(116);
  });

  it.each(entryPoints)("$name parses without syntax or duplicate-declaration errors", ({ file }) => {
    const source = readFileSync(file, "utf8");
    expect(() =>
      parse(source, {
        sourceType: "module",
        sourceFilename: path.relative(root, file),
        plugins: ["typescript", "jsx", "importAttributes"],
      })
    ).not.toThrow();
  });

  it.each(entryPoints)("$name has no broken relative imports", ({ file }) => {
    const source = readFileSync(file, "utf8");
    for (const specifier of localImports(source)) {
      expect(
        resolveLocalImport(file, specifier),
        `${path.relative(root, file)} imports missing local module ${specifier}`,
      ).not.toBeNull();
    }
  });
});
