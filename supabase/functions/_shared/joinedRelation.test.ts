import { joinedRelation } from "./joinedRelation.ts";

Deno.test("joined relation preserves a single object", () => {
  const row = { name: "Northside" };
  if (joinedRelation(row) !== row) throw new Error("Single relation changed");
});

Deno.test("joined relation selects the first returned object", () => {
  const row = { name: "Northside" };
  if (joinedRelation([row, { name: "Southside" }]) !== row) throw new Error("Wrong relation selected");
});

Deno.test("joined relation handles empty and missing joins", () => {
  for (const value of [[], null, undefined]) {
    if (joinedRelation(value) !== undefined) throw new Error("Missing join was fabricated");
  }
});

Deno.test("joined relation resolves nested team and club joins", () => {
  const team = joinedRelation([{ name: "Under 12", clubs: [{ name: "Northside" }] }]);
  if (team?.name !== "Under 12" || joinedRelation(team.clubs)?.name !== "Northside") {
    throw new Error("Nested relation lost its names");
  }
});