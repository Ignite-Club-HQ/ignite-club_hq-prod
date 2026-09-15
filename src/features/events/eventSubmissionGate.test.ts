import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  acquireEventSubmission,
  releaseEventSubmission,
} from "@/features/events/eventSubmissionGate";

describe("event submission gate", () => {
  it("allows the first submission synchronously", () => {
    const lock = { current: false };
    expect(acquireEventSubmission(lock)).toBe(true);
    expect(lock.current).toBe(true);
  });

  it("rejects a same-tick second submission before any rerender", () => {
    const lock = { current: false };
    expect(acquireEventSubmission(lock)).toBe(true);
    expect(acquireEventSubmission(lock)).toBe(false);
  });

  it("permits retry after validation, conflict, or mutation completion", () => {
    const lock = { current: false };
    acquireEventSubmission(lock);
    releaseEventSubmission(lock);
    expect(acquireEventSubmission(lock)).toBe(true);
  });

  it("release is safe even when no submission is currently reserved", () => {
    const lock = { current: false };
    releaseEventSubmission(lock);
    expect(lock.current).toBe(false);
  });
});

describe("Create Event submission-gate wiring", () => {
  const source = readFileSync(resolve(process.cwd(), "src/pages/CreateEventPage.tsx"), "utf8");
  const submit = source.slice(
    source.indexOf("const handleSubmit"),
    source.indexOf("const SectionHeader"),
  );

  it("acquires synchronously before the first awaited validation", () => {
    expect(submit.indexOf("acquireEventSubmission(submissionLockRef)"))
      .toBeLessThan(submit.indexOf('await supabase\n        .from("teams")'));
  });

  it("releases after conflict-read error and genuine conflict", () => {
    const conflictSection = submit.slice(
      submit.indexOf("const conflictResult = await checkForConflicts()"),
      submit.indexOf("setSaving(true)"),
    );
    expect(conflictSection.match(/releaseEventSubmission\(submissionLockRef\)/g))
      .toHaveLength(2);
  });

  it("releases in the mutation finally block so failed writes can retry", () => {
    expect(submit).toMatch(/finally \{\s*setSaving\(false\);\s*releaseEventSubmission\(submissionLockRef\);/);
  });

  it("conflict confirmation closes the dialog and retries with checking bypassed", () => {
    expect(source).toContain("setConflictDialogOpen(false); handleSubmit(true);");
  });
});
