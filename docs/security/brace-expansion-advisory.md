# Accepted Transitive Risk: brace-expansion (GHSA-mh99-v99m-4gvg / CVE-2026-14257)

**Status:** Partially remediated — scoped overrides applied (see "2026-08-02 update"). Do **not** dismiss remaining Dependabot alerts for this advisory as false positives.
**Last reviewed:** 2026-08-02

## 2026-08-02 update — scoped patch overrides

Backports have now shipped for the 1.x and 2.x lines, so major-version substitution is no longer required. `package.json` carries version-scoped npm overrides:

```json
"brace-expansion@1.x": "1.1.17",
"brace-expansion@2.x": "2.1.3"
```

Resolved paths after install: eslint -> minimatch@3 -> `1.1.17`; exceljs/archiver -> minimatch@5 -> `2.1.3`; tailwindcss/sucrase and typescript-eslint -> minimatch@9 -> `2.1.3`; @capacitor/cli -> rimraf/glob -> minimatch@10 -> `5.0.8` (already patched, untouched).

The rules below still apply: no *global* single-version override, no `--force`, no parent downgrades.



## Advisory

- ID: GHSA-mh99-v99m-4gvg (CVE-2026-14257)
- Package: `brace-expansion`
- Class: Denial of service via unbounded expansion length (missing `EXPANSION_MAX_LENGTH` / `maxLength` enforcement in `index.js`).
- Affected: **every release through 5.0.7** across all major lines (1.x, 2.x, 3.x, 4.x, 5.x).
- Patched: **only `brace-expansion@5.0.8`** at time of review. No backports to 1.x / 2.x / 3.x / 4.x have shipped yet.

Earlier CVE-2025-5889 fixes (1.1.12, 2.0.2, 3.0.1, 4.0.1) do **not** address this advisory. Being ">= those" is not sufficient.

## Why we are not remediating right now

Applying a global npm override of `"brace-expansion": "5.0.8"` is a **major-version substitution** across every consumer in the graph. The v1 → v5 and v2 → v5 jumps change the module's public surface and glob-expansion semantics used deep inside ESLint's `minimatch@3`, ExcelJS's `archiver` / `readdir-glob` chain, Sucrase's glob, and typescript-eslint's estree walker. The regression risk to lint, test discovery, and Excel workbook I/O outweighs the DoS exposure of a build-time / dev-time dependency.

Per the remediation spec's STOP CONDITIONS, we do not introduce regression risk solely to make `npm audit` green when no safe compatible fix exists upstream.

## Current dependency paths (all vulnerable per the advisory)

| Path | Installed | Direct parent to upgrade |
|---|---|---|
| `@capacitor/cli → rimraf → glob → minimatch@10` | `brace-expansion@5.0.8` (still <5.0.8 per advisory text — verify on next audit) | `@capacitor/cli` when it ships a rimraf/glob bump pulling `brace-expansion@5.0.8+` |
| `eslint → minimatch@3` | `brace-expansion@1.1.16` | `eslint` — needs `minimatch@3.x` with a backported fix, or an ESLint release that drops `minimatch@3` |
| `exceljs → archiver → readdir-glob → minimatch@5` | `brace-expansion@2.1.2` | `exceljs` / `archiver` — needs `readdir-glob` release using patched `minimatch@5.x` or newer |
| `tailwindcss → sucrase → glob → minimatch@9` | `brace-expansion@2.1.2` | `sucrase` (transitively `tailwindcss`) — needs `glob@10+` with patched `minimatch@9.x` |
| `typescript-eslint → @typescript-eslint/typescript-estree → minimatch@9` | `brace-expansion@2.1.2` | `@typescript-eslint/typescript-estree` — same as above |

Each vulnerable path can only be removed safely when its **direct parent** ships a release pointing at a patched `minimatch` / `brace-expansion`. Until then, the path stays as-is.

## Rules for this advisory

1. Leave the dependency graph unchanged.
2. Do **not** dismiss the Dependabot alerts as false positives — they are accurate; risk is accepted.
3. Do **not** add a global `brace-expansion: 5.0.8` override.
4. Do **not** run `npm audit fix --force`.
5. Do **not** downgrade ESLint (<9.32.0), ExcelJS (<4.4.0), Vite, React Router, or TypeScript to chase this.
6. Re-check on every Dependabot notification for the parent packages listed above. When a parent ships a patched release, upgrade **that parent only**, then re-audit.

## Re-evaluation checklist

Run when any of `@capacitor/cli`, `eslint`, `exceljs`, `archiver`, `tailwindcss`, `sucrase`, or `typescript-eslint` publishes a new minor/patch:

```bash
npm outdated @capacitor/cli eslint exceljs tailwindcss typescript-eslint
npm ls brace-expansion
npm audit
```

If a parent upgrade removes a vulnerable path with no test/build regressions, ship that upgrade in a scoped PR and update this doc.
