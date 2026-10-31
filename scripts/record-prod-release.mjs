// Records which commit each PROD canister runs, after each successful upgrade,
// so an interrupted promotion resumes with only the canisters still behind.
//   node scripts/record-prod-release.mjs <canister> <sha>
//   node scripts/record-prod-release.mjs --all <sha>      (after provisioning)
import { writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { ENVIRONMENTS, REPO_ROOT, UPGRADE_ORDER, loadIds, readRelease } from "./icp-environments.mjs";

export function recordRelease(names, sha, root = REPO_ROOT) {
  if (!/^[0-9a-f]{7,40}$/.test(sha || "")) throw new Error("Commit SHA required");
  const ids = loadIds("prod", root);
  const release = readRelease("prod", root);
  release.canisters ??= {};
  for (const name of names) {
    if (!UPGRADE_ORDER.includes(name) || !ids[name]) throw new Error(`Unknown or unprovisioned PROD canister: ${name}`);
    release.canisters[name] = sha;
  }
  release.updatedAt = new Date().toISOString();
  const file = path.join(root, ENVIRONMENTS.prod.projectDir, "release.json");
  writeFileSync(`${file}.tmp`, JSON.stringify(release, null, 2) + "\n");
  renameSync(`${file}.tmp`, file);
  return release;
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  const [first, sha] = process.argv.slice(2);
  const names = first === "--all" ? UPGRADE_ORDER.filter((n) => loadIds("prod")[n]) : [first];
  recordRelease(names, sha);
  console.log(`recorded PROD release ${sha.slice(0, 12)} for ${names.join(", ")}`);
}
