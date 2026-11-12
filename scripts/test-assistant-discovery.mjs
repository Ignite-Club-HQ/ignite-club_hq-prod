import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const TEST_ASSISTANT_ORIGIN = "https://ignite-club-launchpad.lovable.app";
export const TEST_IDENTITY_ORIGIN = "https://proe7-kqaaa-aaaas-qg6gq-cai.icp0.io";

// Only the Lovable DEV preview/build imports this helper. Do not put these
// files in public/: shared public assets would also ship in PROD builds.
export function testAssistantDiscoveryFiles() {
  const tablePath = fileURLToPath(new URL("../deploy/mainnet/.icp/data/mappings/ic.ids.json", import.meta.url));
  const ids = JSON.parse(readFileSync(tablePath, "utf8"));
  // The Lovable DEV preview builds its own .well-known manifest, separate from
  // the ICP-hosted frontend. Declare only the reviewed g2 club/team service,
  // preserving each service's existing caller-level authorisation.
  const provisionPath = fileURLToPath(new URL("../deploy/groups/g2/provision.json", import.meta.url));
  const provision = JSON.parse(readFileSync(provisionPath, "utf8"));
  const g2Club = provision.canisters?.club_domain;
  if (provision.groupId !== "g2" || provision.deploymentId !== "mainnet" ||
      provision.phase !== "checked" || !provision.installedDomains?.includes("club_domain") ||
      typeof g2Club !== "string" || !/^[a-z0-9]{5}(?:-[a-z0-9]{5}){3}-cai$/.test(g2Club) ||
      Object.values(ids).includes(g2Club)) {
    throw new Error("Reviewed DEV Group 2 club canister required for MCP discovery");
  }
  return {
    "/.well-known/ii-derivation-origin": {
      contentType: "text/plain",
      body: `${TEST_IDENTITY_ORIGIN}\n`,
    },
    "/.well-known/ic-architecture": {
      contentType: "application/json",
      body: JSON.stringify({
        version: "1.0.0",
        canisters: [
          { id: "proe7-kqaaa-aaaas-qg6gq-cai", name: "Ignite TEST frontend", role: "the frontend" },
          ...Object.entries(ids).map(([name, id]) => ({ id, name, role: "backend" })),
          {
            id: g2Club,
            name: "g2/club_domain",
            role: "backend",
            description: "DEV Group 2 clubs, teams, and account-scoped role and membership reads.",
          },
        ],
      }, null, 2) + "\n",
    },
  };
}

export function writeTestAssistantDiscovery(outputDirectory) {
  const files = testAssistantDiscoveryFiles();
  mkdirSync(path.join(outputDirectory, ".well-known"), { recursive: true });
  for (const [url, file] of Object.entries(files)) {
    writeFileSync(path.join(outputDirectory, url.slice(1)), file.body);
  }
  writeFileSync(path.join(outputDirectory, "_headers"), Object.entries(files)
    .map(([url, file]) => `${url}\n  Content-Type: ${file.contentType}\n  Access-Control-Allow-Origin: *\n  Cache-Control: no-cache\n`)
    .join("\n"));
}