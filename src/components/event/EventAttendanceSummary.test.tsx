import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventAttendanceSummary } from "./EventAttendanceSummary";

describe("EventAttendanceSummary", () => {
  it("renders singular and plural player summaries", () => {
    const { rerender } = render(<EventAttendanceSummary summary={{ state: "players", count: 1 }} />);
    expect(screen.getByText("1 player attending")).toBeInTheDocument();
    rerender(<EventAttendanceSummary summary={{ state: "players", count: 2 }} />);
    expect(screen.getByText("2 players attending")).toBeInTheDocument();
  });
  it("renders the social breakdown", () => {
    render(<EventAttendanceSummary summary={{ state: "social", total: 3, adults: 2, children: 1 }} />);
    expect(screen.getByText(/3 attending/)).toBeInTheDocument();
    expect(screen.getByText(/2 adults, 1 child/)).toBeInTheDocument();
  });
  it("renders loading and unavailable states explicitly", () => {
    const { rerender } = render(<EventAttendanceSummary summary={{ state: "loading" }} />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    rerender(<EventAttendanceSummary summary={{ state: "unavailable" }} />);
    expect(screen.getByText("Attendance unavailable")).toHaveClass("text-destructive");
  });
});
