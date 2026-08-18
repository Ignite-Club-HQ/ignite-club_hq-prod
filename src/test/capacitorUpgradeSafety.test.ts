import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import capacitorConfig from "../../capacitor.config";

const root = path.resolve(import.meta.dirname, "../..");

const readJson = (relativePath: string) =>
  JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));

const readText = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const codemagic = readText("codemagic.yaml");
const swiftPackage = readText("ios/App/CapApp-SPM/Package.swift");

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

const atLeast = (actual: string, minimum: string): boolean => {
  const left = versionTuple(actual);
  const right = versionTuple(minimum);
  return left.some((part, index) => part > right[index] && left.slice(0, index).every((value, i) => value === right[i]))
    || left.every((part, index) => part === right[index]);
};

describe("Capacitor native-build contracts", () => {
  it("keeps the bundled app identity and local web assets stable", () => {
    expect(capacitorConfig.appId).toBe("app.lovable.igniteteamhub");
    expect(capacitorConfig.webDir).toBe("dist");
    expect(capacitorConfig.server).toMatchObject({
      androidScheme: "https",
      iosScheme: "https",
    });
    expect(capacitorConfig).not.toHaveProperty("server.url");
  });

  it("keeps notification ownership single to prevent duplicate alerts", () => {
    expect(capacitorConfig.plugins?.PushNotifications).toMatchObject({
      presentationOptions: ["badge", "sound", "alert"],
    });
    expect(capacitorConfig.plugins?.FirebaseMessaging).toMatchObject({
      presentationOptions: [],
    });
  });

  it("retains keyboard and native HTTP behaviour relied on by the app", () => {
    expect(capacitorConfig.plugins?.CapacitorHttp).toMatchObject({ enabled: true });
    expect(capacitorConfig.plugins?.Keyboard).toMatchObject({
      resize: "none",
      resizeOnFullScreen: false,
    });
  });

  it("keeps the official Capacitor runtime packages on one major version", () => {
    const runtimePackages = [
      "@capacitor/core",
      "@capacitor/android",
      "@capacitor/ios",
    ];
    const majors = runtimePackages.map((name) => versionTuple(resolvedVersion(name))[0]);

    expect(new Set(majors)).toEqual(new Set([8]));
  });

  it("keeps the checked-in iOS SPM runtime aligned with @capacitor/core", () => {
    const coreVersion = resolvedVersion("@capacitor/core");
    expect(swiftPackage).toContain(
      `.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "${coreVersion}")`,
    );
  });

  it("keeps every Codemagic-generated iOS SPM runtime aligned with @capacitor/core", () => {
    const coreVersion = resolvedVersion("@capacitor/core");
    const declarations = [
      ...codemagic.matchAll(
        /\.package\(url: "https:\/\/github\.com\/ionic-team\/capacitor-swift-pm\.git", exact: "([^"]+)"\)/g,
      ),
    ];

    expect(declarations.length).toBeGreaterThanOrEqual(2);
    expect(declarations.map((match) => match[1])).toEqual(
      declarations.map(() => coreVersion),
    );
  });

  it("uses a Node version supported by the proposed Capacitor CLI", () => {
    const nodeVersions = [...codemagic.matchAll(/^\s+node:\s+(\d+)\s*$/gm)].map(
      (match) => Number(match[1]),
    );

    expect(nodeVersions.length).toBeGreaterThanOrEqual(4);
    expect(nodeVersions.every((version) => version >= 22)).toBe(true);
  });

  it("continues to sync and compile both native platforms in Codemagic", () => {
    expect(codemagic).toContain("npx cap sync android");
    expect(codemagic).toContain("npx cap sync ios");
    expect(codemagic).toContain("./gradlew bundleRelease");
    expect(codemagic).toContain("xcodebuild -project App.xcodeproj");
  });

  it("retains custom-scheme and universal-link Android patches", () => {
    expect(codemagic).toContain('android:scheme="igniteclubhq"');
    expect(codemagic).toContain('android:host="igniteclubhq.app"');
    expect(codemagic).toContain("android:autoVerify");
  });

  it("retains the critical native integration packages", () => {
    const requiredPackages = [
      "@capacitor/app",
      "@capacitor/browser",
      "@capacitor/camera",
      "@capacitor/filesystem",
      "@capacitor/keyboard",
      "@capacitor/network",
      "@capacitor/push-notifications",
      "@capacitor/share",
      "@capacitor/status-bar",
      "@capacitor-firebase/crashlytics",
      "@capacitor-firebase/messaging",
      "@capgo/capacitor-native-biometric",
    ];

    const dependencies = packageJson.dependencies ?? {};
    for (const packageName of requiredPackages) {
      expect(
        dependencies,
        `${packageName} must remain an explicit dependency`,
      ).toHaveProperty(packageName);
    }
  });
});

describe("Capacitor CLI security acceptance gate", () => {
  it("uses the reviewed Capacitor CLI release or newer within major 8", () => {
    const cliVersion = resolvedVersion("@capacitor/cli");
    expect(versionTuple(cliVersion)[0]).toBe(8);
    expect(atLeast(cliVersion, "8.4.2")).toBe(true);
  });

  it("does not resolve the vulnerable node-tar range", () => {
    const tarVersion = resolvedVersion("tar");
    expect(atLeast(tarVersion, "7.5.19")).toBe(true);
  });
});
