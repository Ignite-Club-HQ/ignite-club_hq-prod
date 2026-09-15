import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DOMImplementation, DOMParser, XMLSerializer } from "@xmldom/xmldom";
import plist from "plist";

const root = path.resolve(import.meta.dirname, "../..");
const packageLock = JSON.parse(
  fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
);

function versionTuple(version: string): [number, number, number] {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Unsupported semantic version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function atLeast(actual: string, minimum: string): boolean {
  const left = versionTuple(actual);
  const right = versionTuple(minimum);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return true;
}

function xmldomResolutions(): Array<{ path: string; version: string }> {
  return Object.entries(packageLock.packages ?? {})
    .filter(([lockPath]) => lockPath.endsWith("node_modules/@xmldom/xmldom"))
    .map(([lockPath, metadata]: [string, any]) => ({
      path: lockPath,
      version: metadata.version,
    }));
}

describe("xmldom/Capacitor plist compatibility", () => {
  it("keeps xmldom confined to the Capacitor CLI plist dependency path", () => {
    expect(packageLock.packages["node_modules/plist"]?.dependencies).toMatchObject({
      "@xmldom/xmldom": "^0.8.8",
    });
    expect(packageLock.packages["node_modules/@capacitor/cli"]?.dependencies).toMatchObject({
      plist: "^3.1.0",
    });
    expect(xmldomResolutions()).toHaveLength(1);
  });

  it("round-trips the native plist values Ignite relies on", () => {
    const nativeConfiguration = {
      CFBundleDisplayName: "Ignite Club HQ",
      CFBundleIdentifier: "app.lovable.igniteteamhub",
      CFBundleURLTypes: [
        {
          CFBundleURLName: "app.lovable.igniteteamhub",
          CFBundleURLSchemes: ["igniteclubhq"],
        },
      ],
      NSCameraUsageDescription: "Upload photos & match-day media",
      UIBackgroundModes: ["remote-notification"],
      ITSAppUsesNonExemptEncryption: false,
      IgniteNestedSettings: {
        retries: 3,
        enabled: true,
      },
    };

    const xml = plist.build(nativeConfiguration);
    expect(plist.parse(xml)).toEqual(nativeConfiguration);
    expect(xml).toContain("Ignite Club HQ");
    expect(xml).toContain("Upload photos &amp; match-day media");
  });

  it("continues to parse and serialize ordinary namespaced XML", () => {
    const source =
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android">' +
      '<application android:label="Ignite &amp; Club HQ"/>' +
      "</manifest>";
    const document = new DOMParser().parseFromString(source, "application/xml");
    const serialized = new XMLSerializer().serializeToString(document);

    expect(document.documentElement.tagName).toBe("manifest");
    expect(document.getElementsByTagName("application")[0].getAttribute("android:label"))
      .toBe("Ignite & Club HQ");
    expect(serialized).toContain('android:label="Ignite &amp; Club HQ"');
  });
});

describe("xmldom 0.8.13 security acceptance gate", () => {
  it("resolves every xmldom copy to the reviewed patched version", () => {
    const resolutions = xmldomResolutions();
    expect(resolutions.length).toBeGreaterThan(0);
    for (const resolution of resolutions) {
      expect(
        atLeast(resolution.version, "0.8.13"),
        `${resolution.path} resolved vulnerable xmldom ${resolution.version}`,
      ).toBe(true);
    }
  });

  it("rejects injection-prone comments when well-formed serialization is required", () => {
    const document = new DOMImplementation().createDocument(null, "root");
    document.documentElement.appendChild(
      document.createComment("safe--> <injected/> <!--"),
    );
    const serialize = new XMLSerializer().serializeToString as any;

    expect(() =>
      serialize.call(
        new XMLSerializer(),
        document,
        false,
        undefined,
        { requireWellFormed: true },
      ),
    ).toThrow();
  });

  it("rejects injection-prone processing instructions in well-formed mode", () => {
    const document = new DOMImplementation().createDocument(null, "root");
    document.documentElement.appendChild(
      document.createProcessingInstruction("ignite", "safe?> <injected/>"),
    );
    const serialize = new XMLSerializer().serializeToString as any;

    expect(() =>
      serialize.call(
        new XMLSerializer(),
        document,
        false,
        undefined,
        { requireWellFormed: true },
      ),
    ).toThrow();
  });

  it("handles deeply nested DOM traversal without exhausting the call stack", () => {
    const document = new DOMImplementation().createDocument(null, "root");
    let cursor = document.documentElement;
    for (let depth = 0; depth < 12_000; depth += 1) {
      const child = document.createElement("n");
      cursor.appendChild(child);
      cursor = child;
    }

    expect(() => new XMLSerializer().serializeToString(document)).not.toThrow();
    expect(document.getElementsByTagName("n").length).toBe(12_000);
  });
});
