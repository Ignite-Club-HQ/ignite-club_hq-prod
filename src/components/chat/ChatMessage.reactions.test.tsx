import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureFreshSession: vi.fn(),
  isAuthLikeError: vi.fn(() => false),
  insertPayloads: [] as Record<string, unknown>[],
  updatePayloads: [] as Record<string, unknown>[],
  deleteIds: [] as string[],
  singleResult: Promise.resolve({ data: null, error: null }) as Promise<any>,
  mutationToast: vi.fn(),
}));

vi.mock("@/lib/ensureFreshSession", () => ({
  ensureFreshSession: mocks.ensureFreshSession,
  isAuthLikeError: mocks.isAuthLikeError,
}));
vi.mock("@/hooks/useBlockedUsers", () => ({
  useBlockedUsers: () => ({ isBlocked: () => false }),
}));
vi.mock("@/lib/haptics", () => ({
  hapticImpactLight: vi.fn(),
  hapticSelectionTick: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.mutationToast },
}));
vi.mock("./MessageReactions", () => ({
  MessageReactionsPopover: ({ reactions, onReact }: any) => (
    <div>
      <button type="button" onClick={() => onReact("like")}>React heart</button>
      <button type="button" onClick={() => onReact("laugh")}>React laugh</button>
      <output data-testid="reaction-state">
        {reactions.map((reaction: any) => `${reaction.user_id}:${reaction.reaction_type}`).join("|")}
      </output>
    </div>
  ),
  MessageReactionsDisplay: () => null,
}));
vi.mock("./MessageContent", () => ({
  MessageContent: ({ text }: { text: string }) => <span>{text}</span>,
}));
vi.mock("./MessageReadAvatars", () => ({ MessageReadAvatars: () => null }));
vi.mock("./MessageReadIndicator", () => ({ MessageReadIndicator: () => null }));
vi.mock("./ReadReceiptSheet", () => ({ ReadReceiptSheet: () => null }));
vi.mock("./ReplyPreview", () => ({ ReplyIndicator: () => null }));
vi.mock("./FullscreenImageViewer", () => ({ FullscreenImageViewer: () => null }));
vi.mock("@/components/BlockUserDialog", () => ({ BlockUserDialog: () => null }));
vi.mock("@/components/chat/ReportMessageDialog", () => ({ ReportMessageDialog: () => null }));
vi.mock("@/components/chat/MessageActionSheet", () => ({ MessageActionSheet: () => null }));
vi.mock("@/components/chat/ForwardMessageSheet", () => ({ ForwardMessageSheet: () => null }));
vi.mock("@/components/chat/InlineRsvpActions", () => ({ InlineRsvpActions: () => null }));

vi.mock("@/integrations/supabase/client", () => {
  const chain: any = {
    insert: vi.fn((payload: Record<string, unknown>) => {
      mocks.insertPayloads.push(payload);
      return chain;
    }),
    update: vi.fn((payload: Record<string, unknown>) => {
      mocks.updatePayloads.push(payload);
      return chain;
    }),
    delete: vi.fn(() => chain),
    eq: vi.fn((column: string, value: string) => {
      if (column === "id" && chain.__deleting) mocks.deleteIds.push(value);
      return chain;
    }),
    select: vi.fn(() => chain),
    single: vi.fn(() => mocks.singleResult),
    maybeSingle: vi.fn(() => mocks.singleResult),
  };
  chain.delete.mockImplementation(() => {
    chain.__deleting = true;
    return chain;
  });
  return { supabase: { from: vi.fn(() => chain) } };
});

import { ChatMessage, type ChatMessageProps } from "./ChatMessage";

const userId = "user-current";
const messageId = "message-1";
const foreignKeys = {
  team: "team_message_id",
  club: "club_message_id",
  broadcast: "broadcast_message_id",
  dm: "direct_message_id",
  club_admin: "club_admin_message_id",
} as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function renderMessage(
  messageType: keyof typeof foreignKeys,
  reactions: ChatMessageProps["reactions"] = [],
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const queryKey = [`${messageType}-messages`, "scope-1"];
  client.setQueryData(queryKey, [{
    id: messageId,
    text: "Reaction target",
    reactions,
  }]);

  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ChatMessage
          id={messageId}
          text="Reaction target"
          authorId="other-user"
          authorName="Other user"
          timestamp="2026-07-31T00:00:00.000Z"
          isOwn={false}
          reactions={reactions}
          currentUserId={userId}
          messageType={messageType}
          queryKey={queryKey}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );

  return client;
}

describe("shared chat reaction behaviour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertPayloads.length = 0;
    mocks.updatePayloads.length = 0;
    mocks.deleteIds.length = 0;
    mocks.ensureFreshSession.mockResolvedValue(userId);
    mocks.singleResult = Promise.resolve({
      data: { id: "reaction-server", user_id: userId, reaction_type: "like" },
      error: null,
    });
  });

  for (const [messageType, foreignKey] of Object.entries(foreignKeys) as Array<
    [keyof typeof foreignKeys, string]
  >) {
    it(`${messageType} displays a heart optimistically and writes its exact message scope`, async () => {
      const pending = deferred<any>();
      mocks.singleResult = pending.promise;
      renderMessage(messageType);

      fireEvent.click(screen.getByRole("button", { name: "React heart" }));

      await waitFor(() =>
        expect(screen.getByTestId("reaction-state")).toHaveTextContent(`${userId}:like`),
      );
      await waitFor(() => expect(mocks.insertPayloads).toHaveLength(1));
      expect(mocks.insertPayloads[0]).toEqual({
        [foreignKey]: messageId,
        user_id: userId,
        reaction_type: "like",
      });

      pending.resolve({
        data: { id: "reaction-server", user_id: userId, reaction_type: "like" },
        error: null,
      });
      await waitFor(() => {
        expect(screen.getByTestId("reaction-state")).toHaveTextContent(`${userId}:like`);
        expect(screen.getByTestId("reaction-state").textContent?.split("|")).toHaveLength(1);
      });
    });
  }

  for (const messageType of Object.keys(foreignKeys) as Array<keyof typeof foreignKeys>) {
    it(`${messageType} rolls an optimistic reaction back when the write is denied`, async () => {
      mocks.singleResult = Promise.resolve({
        data: null,
        error: { code: "42501", message: "reaction denied" },
      });
      renderMessage(messageType);

      fireEvent.click(screen.getByRole("button", { name: "React heart" }));
      await waitFor(() =>
        expect(screen.getByTestId("reaction-state")).toHaveTextContent(`${userId}:like`),
      );

      await waitFor(() => expect(screen.getByTestId("reaction-state")).toBeEmptyDOMElement());
      expect(mocks.mutationToast).toHaveBeenCalledWith(
        "Couldn't update reaction. Please try again.",
      );
      expect(mocks.mutationToast).not.toHaveBeenCalledWith(
        expect.stringMatching(/42501|supabase|rls|permission/i),
      );
    });
  }

  it("replaces the current user's reaction optimistically without duplicating it", async () => {
    mocks.singleResult = Promise.resolve({
      data: { id: "reaction-existing", user_id: userId, reaction_type: "laugh" },
      error: null,
    });
    renderMessage("club", [{
      id: "reaction-existing",
      user_id: userId,
      reaction_type: "like",
    }]);

    fireEvent.click(screen.getByRole("button", { name: "React laugh" }));
    await waitFor(() =>
      expect(screen.getByTestId("reaction-state")).toHaveTextContent(`${userId}:laugh`),
    );
    expect(screen.getByTestId("reaction-state")).not.toHaveTextContent(`${userId}:like`);
    await waitFor(() => expect(mocks.updatePayloads).toContainEqual({ reaction_type: "laugh" }));
  });

  it("removes the current user's selected reaction optimistically", async () => {
    mocks.singleResult = Promise.resolve({ data: null, error: null });
    renderMessage("dm", [{
      id: "reaction-existing",
      user_id: userId,
      reaction_type: "like",
    }]);

    fireEvent.click(screen.getByRole("button", { name: "React heart" }));
    await waitFor(() => expect(screen.getByTestId("reaction-state")).toBeEmptyDOMElement());
    await waitFor(() => expect(mocks.deleteIds).toContain("reaction-existing"));
  });
});
