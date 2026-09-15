import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EventDateCalendarRow } from "./EventDateCalendarRow";

describe("EventDateCalendarRow", () => {
  it("formats the event time and exposes one accessible export action", () => {
    const onExport = vi.fn();
    render(<EventDateCalendarRow eventDate="2026-08-12T10:30:00Z" onExport={onExport} />);
    expect(screen.getByText("Wednesday, August 12 at 10:30 AM")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add to calendar" }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});
