import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AuthMethodChoice } from "./AuthMethodChoice";

const props = {
  value: "supabase" as const,
  onChange: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("sign-in method choice", () => {
  it("switches directly to the selected provider", () => {
    render(<AuthMethodChoice {...props} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Sign in securely/ }), { button: 0, ctrlKey: false });
    expect(props.onChange).toHaveBeenCalledWith("icp");
  });
  it("does not switch providers while sign-in is busy", () => {
    render(<AuthMethodChoice {...props} disabled />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Sign in securely/ }), { button: 0, ctrlKey: false });
    expect(props.onChange).not.toHaveBeenCalled();
  });
});
