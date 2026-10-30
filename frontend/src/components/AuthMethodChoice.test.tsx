import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AuthMethodChoice } from "./AuthMethodChoice";

const props = {
  shellStyle: {},
  onUseEmail: vi.fn(),
  onUseSecure: vi.fn(),
  emailClubNames: ["Bridgewater Soccer Club", "Basket Range Cricket Club"],
  online: true,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("sign-in method choice", () => {
  it("offers both paths with equal weight and names the email clubs", () => {
    render(<AuthMethodChoice {...props} />);
    expect(screen.getByRole("heading", { name: "Welcome to Ignite" })).toBeInTheDocument();
    const email = screen.getByRole("button", { name: /Sign in with email/ });
    const secure = screen.getByRole("button", { name: /Sign in securely/ });
    expect(email).toBeInTheDocument();
    expect(secure).toBeInTheDocument();
    expect(email.textContent).toContain("Bridgewater Soccer Club");
    expect(email.textContent).toContain("Basket Range Cricket Club");
    expect(secure.textContent).toContain("new clubs and new members");
  });

  it("sends each tap to its own sign-in system", () => {
    render(<AuthMethodChoice {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Sign in with email/ }));
    expect(props.onUseEmail).toHaveBeenCalledOnce();
    expect(props.onUseSecure).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Sign in securely/ }));
    expect(props.onUseSecure).toHaveBeenCalledOnce();
  });

  it("words a single club as that club's own path", () => {
    render(<AuthMethodChoice {...props} emailClubNames={["Bridgewater Soccer Club"]} />);
    expect(screen.getByRole("button", { name: /Sign in with email/ }).textContent)
      .toContain("For Bridgewater Soccer Club members.");
  });

  it("says signing in needs a connection when offline", () => {
    render(<AuthMethodChoice {...props} online={false} />);
    expect(screen.getByRole("alert").textContent).toContain("internet connection");
  });
});
