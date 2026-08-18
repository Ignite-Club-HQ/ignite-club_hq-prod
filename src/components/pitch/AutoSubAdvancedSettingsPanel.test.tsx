import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AutoSubAdvancedSettingsPanel from "./AutoSubAdvancedSettingsPanel";

const renderPanel = ({
  open = true,
  overrides = {},
  readOnly = false,
  onChange = vi.fn(),
  onToggle = vi.fn(),
}: Partial<React.ComponentProps<typeof AutoSubAdvancedSettingsPanel>> = {}) => {
  render(
    <AutoSubAdvancedSettingsPanel
      open={open}
      onToggle={onToggle}
      overrides={overrides}
      readOnly={readOnly}
      onChange={onChange}
      defaultMaxSpreadMinutes={5}
    />,
  );
  return { onChange, onToggle };
};

describe("AutoSub advanced settings", () => {
  it("keeps expert controls collapsed until requested", () => {
    const { onToggle } = renderPanel({ open: false });
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /Show expert controls/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("shows all six live planner thresholds with established defaults", () => {
    renderPanel();
    expect(screen.getAllByRole("slider")).toHaveLength(6);
    expect(screen.getByRole("slider", { name: "Fairer minutes vs fewer stoppages" })).toHaveValue("420");
    expect(screen.getByRole("slider", { name: "Max playing-time spread" })).toHaveValue("300");
    expect(screen.getByRole("slider", { name: "Space out substitution moments" })).toHaveValue("240");
    expect(screen.getByRole("slider", { name: "Space out substitution moments (Frequent mode)" })).toHaveValue("180");
  });

  it("merges a changed threshold without discarding unrelated overrides", () => {
    const onChange = vi.fn();
    renderPanel({ overrides: { minShiftSeconds: 240 }, onChange });
    fireEvent.change(screen.getByRole("slider", { name: "Fairer minutes vs fewer stoppages" }), {
      target: { value: "360" },
    });
    expect(onChange).toHaveBeenCalledWith({ minShiftSeconds: 240, standardTargetIntervalSec: 360 });
  });

  it("resets one changed threshold without clearing other custom settings", () => {
    const onChange = vi.fn();
    renderPanel({ overrides: { minShiftSeconds: 240, halftimeGuardSeconds: 240 }, onChange });
    fireEvent.click(screen.getByRole("button", { name: "Reset Allow short cameos vs protect player shifts" }));
    expect(onChange).toHaveBeenCalledWith({ halftimeGuardSeconds: 240 });
  });

  it("reports the custom-setting count and resets all settings in one action", () => {
    const onChange = vi.fn();
    renderPanel({ overrides: { minShiftSeconds: 240, maxSpreadOverrideSec: 240 }, onChange });
    expect(screen.getByText("2 custom")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset all to defaults" }));
    expect(onChange).toHaveBeenCalledWith({});
  });

  it("shows externally managed values without allowing local mutation", () => {
    const onChange = vi.fn();
    renderPanel({ overrides: { minShiftSeconds: 240 }, readOnly: true, onChange });
    expect(screen.getByText(/controlled by the parent screen/)).toBeInTheDocument();
    expect(screen.getAllByRole("slider").every((slider) => slider.hasAttribute("disabled"))).toBe(true);
    expect(screen.queryByRole("button", { name: /Reset/ })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
