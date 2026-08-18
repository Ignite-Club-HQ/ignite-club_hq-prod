import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventIdentityHeader } from "./EventIdentityHeader";

describe("EventIdentityHeader", () => {
  it("shows event, club and team identity", () => {
    render(<EventIdentityHeader title="Round 4" clubName="Riverside FC" teamName="U8 Blue" />);
    expect(screen.getByRole("heading", { level: 1, name: "Round 4" })).toBeInTheDocument();
    expect(screen.getByText("Riverside FC")).toBeInTheDocument();
    expect(screen.getByText("U8 Blue")).toBeInTheDocument();
    expect(screen.queryByText("Cancelled")).not.toBeInTheDocument();
  });

  it("marks cancelled events without hiding their identity", () => {
    render(<EventIdentityHeader title="Cancelled match" clubName="Riverside FC" isCancelled />);
    expect(screen.getByRole("heading", { name: "Cancelled match" })).toBeInTheDocument();
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });

  it("omits absent optional club and team labels", () => {
    const { container } = render(<EventIdentityHeader title="Standalone event" />);
    expect(screen.getByRole("heading", { name: "Standalone event" })).toBeInTheDocument();
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });
});
