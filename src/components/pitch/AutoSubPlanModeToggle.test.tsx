import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AutoSubPlanModeToggle from "./AutoSubPlanModeToggle";

describe("AutoSub plan mode toggle", () => {
  it("shows both public modes and their coach-facing tradeoffs", () => {
    render(<AutoSubPlanModeToggle activeMode={1} onChange={vi.fn()} readOnly={false} />);
    expect(screen.getByRole("button", { name: /Standard/ })).toHaveTextContent("Fewer substitutions");
    expect(screen.getByRole("button", { name: /Frequent/ })).toHaveTextContent("tighter rotation");
  });

  it("marks only the selected mode as active", () => {
    render(<AutoSubPlanModeToggle activeMode={2} onChange={vi.fn()} readOnly={false} />);
    expect(screen.getByRole("button", { name: /Standard/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /Frequent/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("On")).toBeInTheDocument();
  });

  it("requests the selected mode once", () => {
    const onChange = vi.fn();
    render(<AutoSubPlanModeToggle activeMode={1} onChange={onChange} readOnly={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Frequent/ }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("blocks an unavailable mode and explains why", () => {
    const onChange = vi.fn();
    render(<AutoSubPlanModeToggle activeMode={1} onChange={onChange} readOnly={false} disabledModes={[2]} />);
    const frequent = screen.getByRole("button", { name: /Frequent/ });
    expect(frequent).toBeDisabled();
    expect(frequent).toHaveTextContent("Unavailable");
    expect(frequent).toHaveAttribute("title", "Not available for this squad size and match length");
    fireEvent.click(frequent);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("hides the control when planner settings are externally managed", () => {
    const { container } = render(<AutoSubPlanModeToggle activeMode={1} onChange={vi.fn()} readOnly />);
    expect(container).toBeEmptyDOMElement();
  });
});
