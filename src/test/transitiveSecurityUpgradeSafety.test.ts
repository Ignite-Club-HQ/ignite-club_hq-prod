import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import picomatch from "picomatch";

const root = path.resolve(import.meta.dirname, "../..");

const readText = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const packageLock = JSON.parse(readText("package-lock.json"));

const resolvedVersion = (packageName: string): string | null => {
  const entry = packageLock.packages?.[`node_modules/${packageName}`];
  return entry?.version ?? null;
};

const versionTuple = (version: string): [number, number, number] => {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Unsupported semantic version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const atLeast = (actual: string, minimum: string): boolean => {
  const left = versionTuple(actual);
  const right = versionTuple(minimum);

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return true;
};

const sourceFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolutePath);
    if (
      !entry.name.match(/\.(ts|tsx)$/)
      || entry.name.match(/\.(test|spec)\.(ts|tsx)$/)
    ) {
      return [];
    }
    return [absolutePath];
  });

describe("security-sensitive transitive dependency boundaries", () => {
  it("keeps Firebase database transports out of the web application source", () => {
    const runtimeSource = sourceFiles(path.join(root, "src"))
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n");

    expect(runtimeSource).not.toMatch(
      /(?:from\s+|import\s*\()\s*["']firebase(?:\/(?:database|firestore))?["']/,
    );
  });

  it("loads native Firebase Messaging only after confirming a native platform", () => {
    const nativePush = readText("src/lib/nativePush.ts");
    const nativeGuard = nativePush.indexOf("if (!capacitorOk || !checkIsNative())");
    const firebaseImport = nativePush.indexOf(
      "import('@capacitor-firebase/messaging')",
    );

    expect(nativeGuard).toBeGreaterThan(-1);
    expect(firebaseImport).toBeGreaterThan(nativeGuard);
  });

  it("keeps PDF generation on text primitives instead of the HTML rendering path", () => {
    const pdfPage = readText("src/pages/VideoGuideDownloadPage.tsx");

    expect(pdfPage).toContain("doc.text(");
    expect(pdfPage).toContain("doc.splitTextToSize(");
    expect(pdfPage).not.toMatch(/\bdoc\.html\s*\(/);
  });

  it("can generate a non-empty PDF with the installed jsPDF runtime", () => {
    const document = new jsPDF();
    document.text("Ignite Club HQ security upgrade check", 15, 15);

    const output = document.output("arraybuffer");
    const signature = new TextDecoder().decode(output.slice(0, 5));

    expect(signature).toBe("%PDF-");
    expect(output.byteLength).toBeGreaterThan(500);
  });

  it("keeps the checked-in service worker independent from Workbox generation", () => {
    const viteConfig = readText("vite.config.ts");
    const main = readText("src/main.tsx");
    const serviceWorker = readText("public/sw.js");

    expect(viteConfig).not.toContain("vite-plugin-pwa");
    expect(viteConfig).not.toContain("VitePWA");
    expect(main).toContain("navigator.serviceWorker.register");
    expect(serviceWorker).toContain("self.addEventListener('push'");
    expect(serviceWorker).toContain("self.addEventListener('notificationclick'");
  });

  it("preserves the test-file glob behaviour used by the Vitest toolchain", () => {
    const includeTest = picomatch("src/**/*.{test,spec}.{ts,tsx}");
    const excludeDependencies = picomatch("**/node_modules/**");

    expect(includeTest("src/hooks/useAuth.test.tsx")).toBe(true);
    expect(includeTest("src/pages/AuthPage.spec.ts")).toBe(true);
    expect(includeTest("src/pages/AuthPage.tsx")).toBe(false);
    expect(excludeDependencies("node_modules/pkg/index.test.ts")).toBe(true);
    expect(excludeDependencies("src/lib/security.test.ts")).toBe(false);
  });

  it("handles ordinary POSIX character classes without method-like pattern injection", () => {
    const numericFixture = picomatch("fixtures/[[:digit:]][[:digit:]].json");
    const sourceFixture = picomatch("src/**/[[:alpha:]]*.test.ts");

    expect(numericFixture("fixtures/42.json")).toBe(true);
    expect(numericFixture("fixtures/ab.json")).toBe(false);
    expect(sourceFixture("src/lib/auth.test.ts")).toBe(true);
    expect(sourceFixture("src/lib/42.test.ts")).toBe(false);
  });
});

describe("transitive dependency security resolution", () => {
  const minimumVersions: Record<string, string> = {
    "@grpc/grpc-js": "1.9.16",
    dompurify: "3.4.13",
    lodash: "4.18.1",
    postcss: "8.5.23",
    protobufjs: "7.6.5",
    "serialize-javascript": "7.0.7",
    undici: "7.29.0",
    "websocket-driver": "0.7.5",
    "workbox-build": "7.4.1",
    ws: "8.21.1",
  };

  for (const [packageName, minimumVersion] of Object.entries(minimumVersions)) {
    it(`omits ${packageName} or resolves it at ${minimumVersion} or newer`, () => {
      const installedVersion = resolvedVersion(packageName);
      if (installedVersion === null) {
        expect(installedVersion).toBeNull();
        return;
      }

      expect(
        atLeast(installedVersion, minimumVersion),
        `${packageName} resolved to ${installedVersion}`,
      ).toBe(true);
    });
  }
});
