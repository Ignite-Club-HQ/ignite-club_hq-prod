import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventPassiveFacts } from "./EventPassiveFacts";

describe("EventPassiveFacts", () => {
  it("shows game opponent and complete arrival guidance", () => {
    render(<EventPassiveFacts eventType="game" opponent="Wolves" arrivalTime="9:45 AM" arrivalMinutes={30} />);
    expect(screen.getByText("vs Wolves")).toBeInTheDocument();
    expect(screen.getByText(/Arrive by 9:45 AM/)).toBeInTheDocument();
    expect(screen.getByText("(30 min before kickoff)")).toBeInTheDocument();
  });
  it.each([{ arrivalTime: null, arrivalMinutes: 30 }, { arrivalTime: "9:45 AM", arrivalMinutes: null }])(
    "omits incomplete arrival guidance", (arrival) => {
      render(<EventPassiveFacts eventType="game" {...arrival} />);
      expect(screen.queryByText(/Arrive by/)).not.toBeInTheDocument();
    },
  );
  it("shows only relevant facts and a two-decimal price for social events", () => {
    render(<EventPassiveFacts eventType="social" price={12.5} opponent="Not applicable" arrivalTime="9:45 AM" arrivalMinutes={30} />);
    expect(screen.getByText("$12.50 per person")).toBeInTheDocument();
    expect(screen.queryByText(/vs |Arrive by/)).not.toBeInTheDocument();
  });
  it.each([0, null, undefined])("omits a non-payable social price (%s)", (price) => {
    render(<EventPassiveFacts eventType="social" price={price} />);
    expect(screen.queryByText(/per person/)).not.toBeInTheDocument();
  });
});
