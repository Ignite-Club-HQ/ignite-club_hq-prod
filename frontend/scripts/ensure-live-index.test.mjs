import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureLiveIndex } from "./ensure-live-index.mjs";

function tempDist() {
  return mkdtempSync(path.join(tmpdir(), "ignite-live-index-"));
}

test("hosting gets index.html copied from the live build entry", () => {
  const dir = tempDist();
  try {
    writeFileSync(path.join(dir, "live-index.html"), "<html>live entry</html>");
    const created = ensureLiveIndex(dir);
    assert.equal(created, path.join(dir, "index.html"));
    assert.equal(readFileSync(path.join(dir, "index.html"), "utf8"), "<html>live entry</html>");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a rebuild replaces an out-of-date index.html", () => {
  const dir = tempDist();
  try {
    writeFileSync(path.join(dir, "index.html"), "<html>old</html>");
    writeFileSync(path.join(dir, "live-index.html"), "<html>new</html>");
    ensureLiveIndex(dir);
    assert.equal(readFileSync(path.join(dir, "index.html"), "utf8"), "<html>new</html>");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the build stops when the live entry page is absent", () => {
  const dir = tempDist();
  try {
    assert.throws(() => ensureLiveIndex(dir), /live-index\.html missing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
