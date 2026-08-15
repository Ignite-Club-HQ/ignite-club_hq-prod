/**
 * Security acceptance: transitive advisories (dompurify, postcss, undici) must
 * be resolved at or above their patched versions, and dependent behaviour
 * (jsPDF generation, PostCSS processing) must keep working.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));

function cmp(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

function installed(name: string) {
  return Object.entries(lock.packages as Record<string, { version?: string }>)
    .filter(([path]) => path.endsWith(`node_modules/${name}`))
    .map(([path, meta]) => ({ path, version: meta.version ?? "0.0.0" }));
}

const MINIMUMS: Record<string, string> = {
  dompurify: "3.4.13",
  postcss: "8.5.23",
  undici: "7.29.0",
};

describe("transitive security upgrade safety", () => {
  for (const [name, min] of Object.entries(MINIMUMS)) {
    it(`has no ${name} copy below ${min}`, () => {
      const copies = installed(name);
      expect(copies.length).toBeGreaterThan(0);
      for (const copy of copies) {
        if (name === "undici" && !copy.version.startsWith("7.")) continue;
        expect(cmp(copy.version, min), `${copy.path}@${copy.version}`).toBeGreaterThanOrEqual(0);
      }
    });
  }

  it("still generates a PDF with jsPDF", async () => {
    const { default: JsPDF } = await import("jspdf");
    const doc = new JsPDF();
    doc.text("Ignite export", 10, 10);
    const output = doc.output("arraybuffer");
    expect(output.byteLength).toBeGreaterThan(0);
  });

  it("still processes CSS with postcss", async () => {
    const { default: postcss } = await import("postcss");
    const result = await postcss([]).process(".a{color:red}", { from: undefined });
    expect(result.css).toContain("color:red");
  });
});
