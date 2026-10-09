// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { shouldIgnoreFixtureCardClick } from "@/lib/fixtureCardClick";

describe("fixture card tap", () => {
  const card = document.createElement("div");
  card.innerHTML = `<span id="name">Red</span><button id="score"><span id="inner">Enter score</span></button><div role="menuitem" id="mi">Edit</div>`;
  it("opens on plain card area", () => expect(shouldIgnoreFixtureCardClick(card, card.querySelector("#name"))).toBe(false));
  it("ignores Enter score button (and its children)", () => expect(shouldIgnoreFixtureCardClick(card, card.querySelector("#inner"))).toBe(true));
  it("ignores menu items", () => expect(shouldIgnoreFixtureCardClick(card, card.querySelector("#mi"))).toBe(true));
  it("ignores clicks from portals outside the card", () => expect(shouldIgnoreFixtureCardClick(card, document.createElement("div"))).toBe(true));
});
