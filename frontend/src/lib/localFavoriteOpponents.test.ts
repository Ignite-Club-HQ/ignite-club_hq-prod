import { beforeEach, describe, expect, it } from "vitest";
import { addLocalFavorite, listLocalFavorites, removeLocalFavorite } from "./localFavoriteOpponents";

describe("device favourite opponents (Internet Identity)", () => {
  beforeEach(() => localStorage.clear());
  it("saves, dedupes and removes per user", () => {
    addLocalFavorite("u1", "Eagles FC", "c1", "t1");
    addLocalFavorite("u1", "eagles fc", "c1", "t1");
    expect(listLocalFavorites("u1", "c1", "t1").map((f) => f.opponent_name)).toEqual(["Eagles FC"]);
    expect(listLocalFavorites("u2")).toEqual([]);
    removeLocalFavorite("u1", listLocalFavorites("u1")[0].id);
    expect(listLocalFavorites("u1")).toEqual([]);
  });
  it("keeps another team's favourites out", () => {
    addLocalFavorite("u1", "Hawks", "c1", "t2");
    expect(listLocalFavorites("u1", "c1", "t1")).toEqual([]);
  });
});
