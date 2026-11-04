import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import { ProOnlyGate, PRO_ONLY_TITLE } from "./ProOnlyGate";

describe("ProOnlyGate", () => {
  beforeEach(() => toast.mockClear());

  it("keeps the tool visible but shows Pro only instead of running it when locked", () => {
    const run = vi.fn();
    render(<ProOnlyGate locked><button onClick={run}>Settings</button></ProOnlyGate>);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(run).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: PRO_ONLY_TITLE }));
  });

  it("runs the tool normally when the club has Pro", () => {
    const run = vi.fn();
    render(<ProOnlyGate locked={false}><button onClick={run}>Settings</button></ProOnlyGate>);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(run).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it("lets plain links through in panels so locked admins can still open fixtures", () => {
    const open = vi.fn((e: any) => e.preventDefault());
    render(
      <ProOnlyGate locked scope="actions">
        <a href="/match/1" onClick={open}>Match</a>
      </ProOnlyGate>,
    );

    fireEvent.click(screen.getByText("Match"));

    expect(open).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
  });
});
