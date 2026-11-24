import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn(), grants: vi.fn(), board: vi.fn(), supabase: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ ensureQueryData: mocks.read }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "coach" } }) }));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => "icp" }));
vi.mock("@/lib/boardReadRepository", () => ({ boardQueryOptions: () => ({ queryKey: ["board"] }) }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: (_: unknown, providers: { icp: (ctx: object) => unknown }) => providers.icp({}) }));
vi.mock("@/live/features/membership", () => ({ listLiveTeamRoleGrants: mocks.grants }));
vi.mock("@/lib/clubTeamCache", () => ({ getCachedTeam: () => ({ name: "Test team" }) }));
vi.mock("@/lib/profileCache", () => ({ selectCachedProfilesByIds: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.supabase } }));
vi.mock("@/components/pitch/PitchBoard", () => ({ default: (props: unknown) => { mocks.board(props); return null; } }));
vi.mock("@/components/ui/dialog", () => ({ Dialog: ({ children }: { children: React.ReactNode }) => children, DialogContent: ({ children }: { children: React.ReactNode }) => children }));

import { BoardViewerDialog } from "./BoardViewerDialog";
import * as deadlines from "@/live/readDeadline";

const row = { pitch_state: { linkedEventId: "selected-match" } };
const grants = [{ account_id: "coach", role: "coach" }];
const open = () => render(<BoardViewerDialog open gameId="team-1" onOpenChange={() => {}} />);

describe("shared board opening", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mocks.read.mockResolvedValue(row);
    mocks.grants.mockResolvedValue(grants);
  });
  afterEach(() => vi.useRealTimers());

  it("preserves the selected match and read-only access without email reads", async () => {
    open();
    await waitFor(() => expect(mocks.board).toHaveBeenCalled());
    expect(mocks.board.mock.calls[0][0]).toMatchObject({ teamId: "team-1", initialLinkedEventId: "selected-match", readOnly: true });
    expect(mocks.supabase).not.toHaveBeenCalled();
  });

  it("allows healthy individual reads whose combined duration exceeds twenty seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mocks.read.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(row), 12_000)));
    mocks.grants.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(grants), 12_000)));
    open();
    await act(async () => { await vi.advanceTimersByTimeAsync(24_000); });
    expect(mocks.grants).toHaveBeenCalledOnce();
    expect(mocks.board).toHaveBeenCalled();
  });

  it("does not continue opening after the read deadline rejects and a late reply arrives", async () => {
    let finish: (value: typeof row) => void = () => {};
    mocks.read.mockReturnValue(new Promise<typeof row>(resolve => { finish = resolve; }));
    const deadline = vi.spyOn(deadlines, "withReadDeadline").mockRejectedValueOnce(new Error("Read timed out"));
    open();
    await Promise.resolve();
    await Promise.resolve();
    finish(row);
    await Promise.resolve();
    expect(deadline).toHaveBeenCalledOnce();
    expect(mocks.grants).not.toHaveBeenCalled();
    expect(mocks.board).not.toHaveBeenCalled();
  });

  it("stops further reads when the viewer is closed during loading", async () => {
    let finish: (value: typeof row) => void = () => {};
    mocks.read.mockReturnValue(new Promise<typeof row>(resolve => { finish = resolve; }));
    const view = open();
    view.unmount();
    await act(async () => { finish(row); });
    expect(mocks.grants).not.toHaveBeenCalled();
    expect(mocks.board).not.toHaveBeenCalled();
  });
});