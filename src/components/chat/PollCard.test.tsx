import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PollCard } from "./PollCard";

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  closed: false,
  votes: [
    { id: "v1", option_id: "yes", user_id: "alice" },
    { id: "v2", option_id: "no", user_id: "bob" },
  ],
  profiles: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "viewer" } }) }));
vi.mock("@/lib/profileCache", () => ({ fetchProfilesWithCache: mocks.profiles }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const result = {
        data: table === "polls" ? { id: "poll1", question: "Are you coming?", allow_multiple: true,
          created_by: "owner", closed_at: mocks.closed ? "2026-10-20T00:00:00Z" : null, closes_at: null }
          : table === "poll_options" ? [{ id: "yes", label: "Yes", position: 0 }, { id: "no", label: "No", position: 1 }]
          : mocks.votes,
        error: null,
      };
      const query = { select: () => query, eq: () => query,
        order: () => Promise.resolve(result), maybeSingle: () => Promise.resolve(result),
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
        insert: mocks.write, delete: mocks.write, update: mocks.write };
      return query;
    },
    channel: () => {
      const channel = { on: () => channel, subscribe: () => channel };
      return channel;
    },
    removeChannel: vi.fn(),
  },
}));

function renderPoll() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><PollCard pollId="poll1" /></QueryClientProvider>);
}

beforeEach(() => {
  cleanup();
  mocks.write.mockClear();
  mocks.closed = false;
  mocks.votes = [{ id: "v1", option_id: "yes", user_id: "alice" }, { id: "v2", option_id: "no", user_id: "bob" }];
  mocks.profiles.mockReset().mockResolvedValue(new Map([
    ["alice", { display_name: "Alice" }], ["bob", { display_name: "Bob" }],
  ]));
});

describe("Poll voter results", () => {
  it("opens from the poll question and groups Yes and No voters without changing any vote", async () => {
    renderPoll();
    expect(mocks.profiles).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "View votes: Are you coming?" }));
    expect(await within(screen.getByRole("region", { name: "Yes voters" })).findByText("Alice")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Yes voters" })).queryByText("Bob")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "No voters" })).getByText("Bob")).toBeInTheDocument();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("allows reading a closed poll and keeps multiple-choice voters in each selected option", async () => {
    mocks.closed = true;
    mocks.votes.push({ id: "v3", option_id: "no", user_id: "alice" });
    renderPoll();
    fireEvent.click(await screen.findByRole("button", { name: "View poll votes" }));
    await waitFor(() => expect(screen.getAllByText("Alice")).toHaveLength(2));
    expect(mocks.profiles).toHaveBeenCalledWith(["alice", "bob"]);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("shows an empty option and does not substitute another member for an unavailable profile", async () => {
    mocks.votes = [{ id: "v1", option_id: "yes", user_id: "missing" }];
    mocks.profiles.mockResolvedValue(new Map());
    renderPoll();
    fireEvent.click(await screen.findByRole("button", { name: "View poll votes" }));
    expect(await screen.findByText("Member (name unavailable)")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "No voters" })).getByText("No votes yet")).toBeInTheDocument();
    expect(mocks.write).not.toHaveBeenCalled();
  });
});