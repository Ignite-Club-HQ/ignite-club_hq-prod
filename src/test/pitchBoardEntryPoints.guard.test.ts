import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(path, "utf8");

describe("football pitch-board production entry-point contract", () => {
  it("Team page opens directly and consumes both resume query contracts", () => {
    const text = source("src/pages/TeamDetailPage.tsx");
    expect(text).toContain("setShowPitchBoard(true)");
    expect(text).toContain('params.get("openBoard") === "1"');
    expect(text).toContain('params.get("openPitchBoard") === "1"');
    expect(text).toContain("clearPitchBoardOpenFlag()");
  });

  it("Event page covers controller, spectator and deep-link entry", () => {
    const text = source("src/pages/EventDetailPage.tsx");
    const actions = source("src/components/event/PitchBoardActions.tsx");
    expect(text).toContain("wantOpenPitchBoard");
    expect(text).toContain("setShowPitchBoard(true)");
    expect(actions).toContain('"Start Game"');
    expect(actions).toContain('"Prepare Lineup & Auto-Subs"');
    expect(actions).toContain('"Open Match"');
    expect(text).toContain("closePitchBoardWithFlag");
  });

  it("Home covers timer-widget and native-notification entry plus cold restore", () => {
    const text = source("src/pages/HomePage.tsx");
    expect(text).toContain("onOpenPitchBoard={(teamId, teamName) => openPitchBoard");
    expect(text).toContain("window.addEventListener('open-pitch-board'");
    expect(text).toContain("ignite-pitch-board-last-context");
    expect(text).toContain("clearPitchBoardOpenFlag()");
  });

  it("Next Up opens the exact event through the common restore parameter", () => {
    const text = source("src/components/NextUpCarousel.tsx");
    expect(text).toContain("`/events/${event.id}?openPitchBoard=1`");
  });

  it("chat details opens the selected team through the team-page contract", () => {
    const text = source("src/components/chat/ChatDetailsSheet.tsx");
    expect(text).toContain("?openBoard=1");
    expect(text).toContain("Open pitch board");
  });

  it("native push and notification bell both dispatch the board-open event", () => {
    expect(source("src/components/PushNotificationManager.tsx"))
      .toContain('new CustomEvent("open-pitch-board"');
    expect(source("src/pages/NotificationsPage.tsx"))
      .toContain("new CustomEvent('open-pitch-board'");
  });

  it("direct mini-league page opens an isolated event-group board", () => {
    const text = source("src/pages/EventGroupPitchPage.tsx");
    expect(text).toContain("onClick={() => setShowPitchBoard(true)}");
    expect(text).toContain("teamId={`event-group-${groupId}`}");
  });

  it("mini-league live widget opens the selected match, not another active game", () => {
    const text = source("src/components/MiniLeagueGameWidgets.tsx");
    expect(text).toContain("onClick={() => openPitchBoard(match)}");
    expect(text).toContain("teamId={`event-group-${activePitchBoard.id}`}");
  });

  it("chat board viewer explicitly mounts the shared board read-only", () => {
    const text = source("src/components/chat/BoardViewerDialog.tsx");
    expect(text).toContain("<PitchBoard");
    expect(text).toMatch(/<PitchBoard[\s\S]*?readOnly/);
  });

  it("every entry receives the shared open-state lifecycle inside PitchBoard", () => {
    const text = source("src/components/pitch/PitchBoard.tsx");
    expect(text).toContain("usePitchBoardLifecycle(");
  });
});
