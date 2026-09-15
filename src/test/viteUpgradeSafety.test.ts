import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

const readText = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const readJson = (relativePath: string) =>
  JSON.parse(readText(relativePath));

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const viteConfig = readText("vite.config.ts");
const viteEnv = readText("src/vite-env.d.ts");
const mainSource = readText("src/main.tsx");
const serviceWorker = readText("public/sw.js");

const resolvedVersion = (packageName: string): string => {
  const entry = packageLock.packages?.[`node_modules/${packageName}`];
  if (!entry?.version) {
    throw new Error(`${packageName} is not resolved in package-lock.json`);
  }
  return entry.version;
};

const versionTuple = (version: string): [number, number, number] => {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Unsupported semantic version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const compareVersions = (leftVersion: string, rightVersion: string): number => {
  const left = versionTuple(leftVersion);
  const right = versionTuple(rightVersion);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
};

const packageResolutions = (
  packageName: string,
): Array<{ path: string; version: string }> =>
  Object.entries<Record<string, any>>(packageLock.packages ?? {})
    .filter(([lockPath, entry]) =>
      (lockPath === `node_modules/${packageName}`
        || lockPath.endsWith(`/node_modules/${packageName}`))
      && typeof entry?.version === "string"
    )
    .map(([lockPath, entry]) => ({ path: lockPath, version: entry.version }));

describe("Vite build contracts that must survive an upgrade", () => {
  it("keeps React, alias and runtime deduplication configuration", () => {
    expect(viteConfig).toContain('import react from "@vitejs/plugin-react"');
    expect(viteConfig).toContain("react()");
    expect(viteConfig).toContain('"@": path.resolve(__dirname, "./src")');
    expect(viteConfig).toContain(
      'dedupe: ["react", "react-dom", "react/jsx-runtime"]',
    );
  });

  it("keeps the Lovable tagger limited to development mode", () => {
    expect(viteConfig).toContain(
      'mode === "development" && componentTagger()',
    );
  });

  it("continues to own the service worker as a checked-in static asset", () => {
    expect(mainSource).toContain("navigator.serviceWorker.register");
    expect(mainSource).toContain("/sw.js?v=");
    expect(serviceWorker).toContain("self.addEventListener('push'");
    expect(serviceWorker).toContain("self.addEventListener('notificationclick'");
    expect(viteConfig).not.toContain("VitePWA");
    expect(viteConfig).not.toContain("vite-plugin-pwa");
  });
});

describe("nested Vite toolchain security resolutions", () => {
  it("keeps every Vite 8 copy at 8.0.16 or newer", () => {
    const vite8 = packageResolutions("vite").filter(
      ({ version }) => versionTuple(version)[0] === 8,
    );
    const vulnerable = vite8.filter(
      ({ version }) => compareVersions(version, "8.0.16") < 0,
    );

    expect(
      vulnerable,
      `Vulnerable nested Vite 8 resolutions remain:\n${vulnerable
        .map(({ path: lockPath, version }) => `${lockPath}: ${version}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  it("keeps every Picomatch 4 copy at 4.0.4 or newer", () => {
    const picomatch4 = packageResolutions("picomatch").filter(
      ({ version }) => versionTuple(version)[0] === 4,
    );
    expect(picomatch4.length).toBeGreaterThan(0);
    const vulnerable = picomatch4.filter(
      ({ version }) => compareVersions(version, "4.0.4") < 0,
    );

    expect(
      vulnerable,
      `Vulnerable Picomatch 4 resolutions remain:\n${vulnerable
        .map(({ path: lockPath, version }) => `${lockPath}: ${version}`)
        .join("\n")}`,
    ).toEqual([]);
  });
});

describe("Vite 7 security and compatibility acceptance gate", () => {
  it("uses a patched Vite 7 release without crossing into Vite 8", () => {
    const viteVersion = resolvedVersion("vite");
    expect(compareVersions(viteVersion, "7.3.5")).toBeGreaterThanOrEqual(0);
    expect(versionTuple(viteVersion)[0]).toBe(7);
  });

  it("declares a Node runtime compatible with Vite 7", () => {
    expect(packageJson.engines?.node).toBeDefined();
    expect(packageJson.engines.node).toMatch(/22\.(?:1[2-9]|[2-9]\d)|>=\s*22\.12/);
  });

  it("removes the unused and Vite-7-incompatible PWA plugin", () => {
    expect(packageJson.dependencies ?? {}).not.toHaveProperty("vite-plugin-pwa");
    expect(packageJson.devDependencies ?? {}).not.toHaveProperty("vite-plugin-pwa");
    expect(packageLock.packages ?? {}).not.toHaveProperty(
      "node_modules/vite-plugin-pwa",
    );
    expect(viteEnv).not.toContain("vite-plugin-pwa/client");
  });

  it("preserves support for the native iOS 15 WebView", () => {
    expect(viteConfig).toMatch(
      /build\s*:\s*\{[\s\S]*target\s*:\s*(?:\[[^\]]*["']safari15["'][^\]]*\]|["']safari15["'])/,
    );
  });

  it("retains plugin versions whose peer ranges include Vite 7", () => {
    const pluginReact = readJson("node_modules/@vitejs/plugin-react/package.json");
    const pluginReactSwc = readJson(
      "node_modules/@vitejs/plugin-react-swc/package.json",
    );
    const lovableTagger = readJson("node_modules/lovable-tagger/package.json");

    expect(pluginReact.peerDependencies?.vite).toContain("^7.0.0");
    expect(pluginReactSwc.peerDependencies?.vite).toMatch(/\b7\b/);
    expect(lovableTagger.peerDependencies?.vite).toMatch(/<8/);
  });
});
