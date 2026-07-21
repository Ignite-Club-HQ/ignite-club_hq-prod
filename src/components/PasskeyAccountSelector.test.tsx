import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PasskeyAccountSelector } from "./PasskeyAccountSelector";

const accounts = [
  {
    email: "alex@example.test",
    displayName: "Alex Rivers",
    addedAt: "2026-01-01T10:00:00.000Z",
  },
  {
    email: "sam@example.test",
    addedAt: "2026-01-02T10:00:00.000Z",
  },
];

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("PasskeyAccountSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows each stored account without hiding its email behind the display name", () => {
    render(
      <PasskeyAccountSelector
        open
        onOpenChange={vi.fn()}
        accounts={accounts}
        onSelectAccount={vi.fn()}
      />,
    );

    expect(screen.getByText("Alex Rivers")).toBeInTheDocument();
    expect(screen.getByText("alex@example.test")).toBeInTheDocument();
    expect(screen.getByText("sam@example.test")).toBeInTheDocument();
  });

  it("selects the exact account email chosen by the user", async () => {
    const onSelectAccount = vi.fn().mockResolvedValue(undefined);
    render(
      <PasskeyAccountSelector
        open
        onOpenChange={vi.fn()}
        accounts={accounts}
        onSelectAccount={onSelectAccount}
      />,
    );

    fireEvent.click(screen.getByText("sam@example.test"));
    await waitFor(() => expect(onSelectAccount).toHaveBeenCalledWith("sam@example.test"));
    expect(onSelectAccount).toHaveBeenCalledOnce();
  });

  it("removes only the requested account without starting authentication", () => {
    const onSelectAccount = vi.fn();
    const onRemoveAccount = vi.fn();
    render(
      <PasskeyAccountSelector
        open
        onOpenChange={vi.fn()}
        accounts={[accounts[0]]}
        onSelectAccount={onSelectAccount}
        onRemoveAccount={onRemoveAccount}
      />,
    );

    fireEvent.click(screen.getAllByTitle("Remove account")[0]);
    expect(onRemoveAccount).toHaveBeenCalledWith("alex@example.test");
    expect(onSelectAccount).not.toHaveBeenCalled();
  });

  it("closes only through the supplied callback when Cancel is available", () => {
    const onOpenChange = vi.fn();
    render(
      <PasskeyAccountSelector
        open
        onOpenChange={onOpenChange}
        accounts={accounts}
        onSelectAccount={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("prevents account selection, removal and cancellation during external loading", () => {
    const onSelectAccount = vi.fn();
    const onRemoveAccount = vi.fn();
    render(
      <PasskeyAccountSelector
        open
        loading
        onOpenChange={vi.fn()}
        accounts={accounts}
        onSelectAccount={onSelectAccount}
        onRemoveAccount={onRemoveAccount}
      />,
    );

    expect(screen.getByRole("button", { name: /Alex Rivers/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /sam@example.test/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    fireEvent.click(screen.getAllByTitle("Remove account")[0]);
    expect(onRemoveAccount).not.toHaveBeenCalled();
    expect(onSelectAccount).not.toHaveBeenCalled();
  });

  it("locks every account and Cancel while authentication is in flight", async () => {
    const pending = deferred<void>();
    const onSelectAccount = vi.fn(() => pending.promise);
    render(
      <PasskeyAccountSelector
        open
        onOpenChange={vi.fn()}
        accounts={accounts}
        onSelectAccount={onSelectAccount}
      />,
    );

    fireEvent.click(screen.getByText("alex@example.test"));

    expect(await screen.findByText("Authenticating...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Alex Rivers/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /sam@example.test/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    pending.resolve();
    await waitFor(() => expect(screen.queryByText("Authenticating...")).not.toBeInTheDocument());
  });

  it("does not submit the same account twice during a rapid double click", async () => {
    const pending = deferred<void>();
    const onSelectAccount = vi.fn(() => pending.promise);
    render(
      <PasskeyAccountSelector
        open
        onOpenChange={vi.fn()}
        accounts={[accounts[0]]}
        onSelectAccount={onSelectAccount}
      />,
    );

    const accountButton = screen.getByRole("button", { name: /Alex Rivers/i });
    fireEvent.click(accountButton);
    fireEvent.click(accountButton);

    expect(onSelectAccount).toHaveBeenCalledOnce();
    pending.resolve();
  });

  it("restores account choices after authentication settles so another account can be chosen", async () => {
    const pending = deferred<void>();
    const onSelectAccount = vi.fn(() => pending.promise);
    render(
      <PasskeyAccountSelector
        open
        onOpenChange={vi.fn()}
        accounts={accounts}
        onSelectAccount={onSelectAccount}
      />,
    );

    fireEvent.click(screen.getByText("alex@example.test"));
    pending.resolve();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Alex Rivers/i })).toBeEnabled();
      expect(screen.getByRole("button", { name: /sam@example.test/i })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    });
  });
});
