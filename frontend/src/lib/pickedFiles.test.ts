import { describe, it, expect } from "vitest";
import { materializePickedFile, PickedFileUnreadableError } from "./pickedFiles";

describe("materializePickedFile", () => {
  it("keeps name, type and bytes", async () => {
    const out = await materializePickedFile(new File(["abc"], "a.png", { type: "image/png" }));
    expect(out.name).toBe("a.png");
    expect(out.type).toBe("image/png");
    expect(await out.text()).toBe("abc");
  });
  it("maps a revoked file to a plain-English error", async () => {
    const bad = { name: "x.jpg", type: "image/jpeg", lastModified: 0, arrayBuffer: () => Promise.reject(new DOMException("x", "NotReadableError")) } as unknown as File;
    await expect(materializePickedFile(bad)).rejects.toBeInstanceOf(PickedFileUnreadableError);
  });
});
