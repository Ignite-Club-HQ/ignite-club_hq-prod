import { describe, expect, it } from "vitest";
import { mergeThemeClubs } from "./mergeThemeClubs";
const row = (clubId: string, clubName: string, hasPro = false) => ({ clubId, clubName, isSelectable: false, hasPro, hasTheme: false, themeEnabled: false });
describe("club theme picker merge", () => {
  it("shows a club once when two groups both return it", () => {
    expect(mergeThemeClubs([[row("c1", "Ignite Soccer Test Club")], [row("c1", "Ignite Soccer Test Club")]])).toHaveLength(1);
  });
  it("keeps the Pro copy when duplicates differ", () => {
    const out = mergeThemeClubs([[row("c1", "A")], [row("c1", "A", true)]]);
    expect(out[0].hasPro).toBe(true);
  });
  it("keeps different clubs with different names", () => {
    expect(mergeThemeClubs([[row("c1", "A")], [row("c2", "B")]])).toHaveLength(2);
  });
});
