import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventLocationDetails, EventLocationMap, resolveEventMapAddress } from "./EventLocationPresentation";

describe("event location presentation", () => {
  it("shows a structured address and uses it as the preferred map query", () => {
    const location = { address: "1 Main Road", suburb: "Riverside", state: "SA", postcode: "5000", locationName: "Oval" };
    render(<><EventLocationDetails {...location} /><EventLocationMap {...location} /></>);
    expect(screen.getByText("1 Main Road")).toBeInTheDocument();
    expect(screen.getByText("Riverside, SA, 5000")).toBeInTheDocument();
    expect(screen.getByTitle("Event location map")).toHaveAttribute(
      "src", "https://www.google.com/maps?q=1%20Main%20Road&output=embed",
    );
  });

  it("shows a venue and distinct legacy location while mapping the legacy location", () => {
    render(<><EventLocationDetails locationName="Riverside Oval" legacyLocation="Pitch 2" /><EventLocationMap locationName="Riverside Oval" legacyLocation="Pitch 2" /></>);
    expect(screen.getByText("Riverside Oval")).toBeInTheDocument();
    expect(screen.getByText("Pitch 2")).toBeInTheDocument();
    expect(resolveEventMapAddress({ locationName: "Riverside Oval", legacyLocation: "Pitch 2" })).toBe("Pitch 2");
  });

  it("does not duplicate matching venue and legacy labels", () => {
    render(<EventLocationDetails locationName="Riverside Oval" legacyLocation="Riverside Oval" />);
    expect(screen.getAllByText("Riverside Oval")).toHaveLength(1);
  });

  it("renders neither venue nor map when location is absent", () => {
    const { container } = render(<><EventLocationDetails /><EventLocationMap /></>);
    expect(container).toBeEmptyDOMElement();
    expect(resolveEventMapAddress({})).toBeNull();
  });
});
