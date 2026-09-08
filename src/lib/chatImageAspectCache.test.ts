import { describe, expect, it } from "vitest";
import {
  appendDimensionsToUrl,
  getCachedImageAspectRatio,
  setCachedImageAspectRatio,
} from "./chatImageAspectCache";

describe("chatImageAspectCache", () => {
  it("clamps URL dimensions to the same portrait bounds used by the rendered image", () => {
    const url = appendDimensionsToUrl("https://example.test/portrait.jpg", 600, 1600);
    expect(getCachedImageAspectRatio([url])).toBe(0.75);
  });

  it("clamps measured ratios before the row estimator reads them", () => {
    const url = "https://example.test/tall-image.jpg";
    setCachedImageAspectRatio([url], 0.4);
    expect(getCachedImageAspectRatio([url])).toBe(0.75);
  });
});