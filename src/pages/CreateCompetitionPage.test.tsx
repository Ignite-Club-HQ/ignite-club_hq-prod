import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
  ensureFreshSession: vi.fn(),
  selectProfile: vi.fn(),
  auth: { user: { id: "user-1" } as null | { id: string } },
  anyPro: { hasAnyClubPro: true, isLoading: false },
  scopedPro: { hasPro: true, isLoading: false },
  results: new Map<string, { data?: any; error?: any }>(),
  operations: [] as Array<{ table: string; action: string; value?: any }>,
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: vi.fn() }));
vi.mock("@/lib/ensureFreshSession", () => ({ ensureFreshSession: mocks.ensureFreshSession }));
vi.mock("@/lib/profileCache", () => ({ selectCachedProfileById: mocks.selectProfile }));
vi.mock("@/hooks/useClubProAccess", () => ({ useClubProAccess: () => mocks.scopedPro }));
vi.mock("@/hooks/useUserHasAnyClubPro", () => ({ useUserHasAnyClubPro: () => mocks.anyPro }));
vi.mock("@/components/subscription/ProFeatureLock", () => ({
  ProFeatureLock: ({ title }: any) => <div data-testid="pro-lock">{title}</div>,
}));
vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [new URLSearchParams()],
}));
vi.mock("@tanstack/react-query", async importOriginal => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: () => ({ data: [], isLoading: false }),
  };
});

import CreateCompetitionPage from "./CreateCompetitionPage";

function tableClient(table: string) {
  const result = () => mocks.results.get(table) ?? { data: null, error: null };
  const query: any = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.in = vi.fn(() => query);
  query.single = vi.fn(async () => result());
  query.delete = vi.fn(() => {
    mocks.operations.push({ table, action: "delete" });
    return query;
  });
  query.insert = vi.fn((value: any) => {
    mocks.operations.push({ table, action: "insert", value });
    if (table === "user_roles") return Promise.resolve(result());
    return query;
  });
  return query;
}

async function enterNameAndCreate(name = "  Winter League  ") {
  fireEvent.change(screen.getByLabelText("Competition name"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: "Create competition" }));
}

describe("personal competition creation workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.results.clear();
    mocks.operations.length = 0;
    mocks.auth.user = { id: "user-1" };
    mocks.anyPro.hasAnyClubPro = true;
    mocks.anyPro.isLoading = false;
    mocks.scopedPro.hasPro = true;
    mocks.scopedPro.isLoading = false;
    mocks.ensureFreshSession.mockResolvedValue(undefined);
    mocks.selectProfile.mockResolvedValue({ data: { display_name: "Alex Morgan" }, error: null });
    mocks.results.set("clubs", { data: { id: "shell-1" }, error: null });
    mocks.results.set("user_roles", { data: null, error: null });
    mocks.results.set("competitions", { data: { id: "competition-1" }, error: null });
    mocks.from.mockImplementation(tableClient);
  });

  it("blocks creation when the user has no qualifying Pro club", () => {
    mocks.anyPro.hasAnyClubPro = false;
    render(<CreateCompetitionPage />);

    expect(screen.getByTestId("pro-lock")).toHaveTextContent("Competitions is a Pro feature");
    expect(screen.queryByRole("button", { name: "Create competition" })).not.toBeInTheDocument();
  });

  it("does not mutate when there is no authenticated user", async () => {
    mocks.auth.user = null;
    render(<CreateCompetitionPage />);
    await enterNameAndCreate();

    expect(mocks.ensureFreshSession).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("stops before all mutations when session freshness cannot be confirmed", async () => {
    mocks.ensureFreshSession.mockRejectedValue(new Error("expired"));
    render(<CreateCompetitionPage />);
    await enterNameAndCreate();

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Session expired",
      description: "Please sign in again and retry.",
      variant: "destructive",
    }));
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("stops when the personal organiser shell cannot be created", async () => {
    mocks.results.set("clubs", { data: null, error: { message: "club insert denied" } });
    render(<CreateCompetitionPage />);
    await enterNameAndCreate();

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Could not create organiser",
      description: "club insert denied",
    })));
    expect(mocks.operations.map(o => o.table)).toEqual(["clubs"]);
  });

  it("creates the shell, admin role and normalized competition in order", async () => {
    render(<CreateCompetitionPage />);
    await enterNameAndCreate();

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/competitions/competition-1"));
    expect(mocks.operations).toEqual([
      {
        table: "clubs",
        action: "insert",
        value: { name: "Alex Morgan's competitions", kind: "shell", created_by: "user-1" },
      },
      {
        table: "user_roles",
        action: "insert",
        value: { user_id: "user-1", club_id: "shell-1", role: "club_admin" },
      },
      {
        table: "competitions",
        action: "insert",
        value: {
          name: "Winter League",
          description: null,
          sport: null,
          season: null,
          organizer_club_id: "shell-1",
          visibility: "private",
          status: "draft",
          created_by: "user-1",
        },
      },
    ]);
    expect(mocks.toast).toHaveBeenCalledWith({ title: "Competition created" });
  });

  it("uses a safe fallback shell name when the profile has no display name", async () => {
    mocks.selectProfile.mockResolvedValue({ data: null, error: null });
    render(<CreateCompetitionPage />);
    await enterNameAndCreate("Autumn Cup");

    await waitFor(() => expect(mocks.operations).toContainEqual({
      table: "clubs",
      action: "insert",
      value: { name: "My's competitions", kind: "shell", created_by: "user-1" },
    }));
  });

  it("must remove the newly-created shell when assigning its admin role fails", async () => {
    mocks.results.set("user_roles", { data: null, error: { message: "role insert denied" } });
    render(<CreateCompetitionPage />);
    await enterNameAndCreate();

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Couldn't set you as organiser admin",
    })));
    expect(mocks.operations).toContainEqual({ table: "clubs", action: "delete" });
    expect(mocks.operations.some(o => o.table === "competitions" && o.action === "insert")).toBe(false);
  });

  it("must remove the new shell and role when competition creation fails", async () => {
    mocks.results.set("competitions", { data: null, error: { message: "competition insert denied" } });
    render(<CreateCompetitionPage />);
    await enterNameAndCreate();

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Could not create competition",
    })));
    expect(mocks.operations).toContainEqual({ table: "user_roles", action: "delete" });
    expect(mocks.operations).toContainEqual({ table: "clubs", action: "delete" });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
