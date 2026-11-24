import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { getPositionFromCoords, type MiniLeagueTeams, type Player, type TeamSize } from "../types";
import type { PitchPosition } from "../PositionBadge";

type PitchPositionCoordinates = { x: number; y: number };

interface UsePitchBoardPitchGeometryArgs {
  containerRef: MutableRefObject<HTMLDivElement | null>;
  playersRef: MutableRefObject<Player[]>;
  playerDragOffsetRef: MutableRefObject<PitchPositionCoordinates | null>;
  playerDragStartRef: MutableRefObject<{
    playerId: string;
    position: PitchPositionCoordinates;
    currentPitchPosition?: PitchPosition;
  } | null>;
  miniLeagueTeams?: MiniLeagueTeams;
  selectedTeamForSettings: "a" | "b" | "both";
  teamSize: TeamSize;
  setPlayers: Dispatch<SetStateAction<Player[]>>;
  pushToUndoHistory: (description: string, players: Player[]) => void;
  flashSwapFeedback: (firstPlayerId: string, secondPlayerId: string) => void;
}

export function usePitchBoardPitchGeometry({
  containerRef,
  playersRef,
  playerDragOffsetRef,
  playerDragStartRef,
  miniLeagueTeams,
  selectedTeamForSettings,
  teamSize,
  setPlayers,
  pushToUndoHistory,
  flashSwapFeedback,
}: UsePitchBoardPitchGeometryArgs) {
  const clampPitchPosition = useCallback((x: number, y: number): PitchPositionCoordinates => ({
    x: Math.max(5, Math.min(95, x)),
    y: Math.max(5, Math.min(95, y)),
  }), []);

  const capturePlayerDragOffset = useCallback((playerId: string, clientX: number, clientY: number) => {
    if (!containerRef.current) {
      playerDragOffsetRef.current = null;
      return;
    }
    const player = playersRef.current.find((candidate) => candidate.id === playerId);
    if (!player?.position) {
      playerDragOffsetRef.current = null;
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    playerDragOffsetRef.current = {
      x: ((clientX - rect.left) / rect.width) * 100 - player.position.x,
      y: ((clientY - rect.top) / rect.height) * 100 - player.position.y,
    };
  }, [containerRef, playerDragOffsetRef, playersRef]);

  const getClientPitchPosition = useCallback((clientX: number, clientY: number) => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const offset = playerDragOffsetRef.current;
    return clampPitchPosition(
      ((clientX - rect.left) / rect.width) * 100 - (offset?.x ?? 0),
      ((clientY - rect.top) / rect.height) * 100 - (offset?.y ?? 0),
    );
  }, [clampPitchPosition, containerRef, playerDragOffsetRef]);

  const getClientPointFromPitchPosition = useCallback((position: PitchPositionCoordinates) => {
    if (!containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: rect.left + (position.x / 100) * rect.width,
      y: rect.top + (position.y / 100) * rect.height,
    };
  }, [containerRef]);

  const canTargetPlayer = useCallback((player: Player, excludedPlayerId?: string) => {
    if (!player.position || player.id === excludedPlayerId) return false;
    return !(
      miniLeagueTeams &&
      selectedTeamForSettings !== "both" &&
      player.teamSide !== selectedTeamForSettings
    );
  }, [miniLeagueTeams, selectedTeamForSettings]);

  /**
   * Drop-to-swap target. Only a player the dragged token is really dropped ON
   * counts: the release point must sit inside the target token, or the two
   * tokens must overlap by at least 40% of the smaller one. No proximity slop,
   * so placing a player in open space next to a team-mate never moves them.
   */
  const getPitchPlayerOverlappingDragged = useCallback((draggedPlayerId: string, clientX: number, clientY: number) => {
    const tokens = Array.from(
      document.querySelectorAll<HTMLElement>('[data-player-variant="pitch"][data-player-id]'),
    );
    const draggedRect = tokens
      .find((token) => token.getAttribute("data-player-id") === draggedPlayerId)
      ?.getBoundingClientRect();
    let best: { id: string; score: number } | null = null;
    for (const token of tokens) {
      const playerId = token.getAttribute("data-player-id");
      const player = playerId
        ? playersRef.current.find((candidate) => candidate.id === playerId)
        : undefined;
      if (!player || !canTargetPlayer(player, draggedPlayerId)) continue;
      const rect = token.getBoundingClientRect();
      const pointInside = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
      let overlapRatio = 0;
      if (draggedRect && draggedRect.width > 0 && rect.width > 0) {
        const overlapX = Math.max(0, Math.min(draggedRect.right, rect.right) - Math.max(draggedRect.left, rect.left));
        const overlapY = Math.max(0, Math.min(draggedRect.bottom, rect.bottom) - Math.max(draggedRect.top, rect.top));
        const smaller = Math.min(draggedRect.width * draggedRect.height, rect.width * rect.height);
        overlapRatio = smaller > 0 ? (overlapX * overlapY) / smaller : 0;
      }
      if (!pointInside && overlapRatio < 0.4) continue;
      const score = (pointInside ? 1 : 0) + overlapRatio;
      if (!best || score > best.score) best = { id: player.id, score };
    }
    return best?.id ?? null;
  }, [canTargetPlayer, playersRef]);

  const getDraggedPlayerPositionType = useCallback((player: Player, position: PitchPositionCoordinates) => {
    const y = miniLeagueTeams && player.teamSide === "b" ? 100 - position.y : position.y;
    return getPositionFromCoords(y, teamSize);
  }, [miniLeagueTeams, teamSize]);

  const updateDraggedPlayerPosition = useCallback((playerId: string, position: PitchPositionCoordinates) => {
    setPlayers((previousPlayers) =>
      previousPlayers.map((player) =>
        player.id === playerId
          ? {
              ...player,
              position,
              currentPitchPosition: getDraggedPlayerPositionType(player, position),
            }
          : player,
      ),
    );
  }, [getDraggedPlayerPositionType, setPlayers]);

  const swapPitchPlayers = useCallback((sourcePlayerId: string, targetPlayerId: string) => {
    if (sourcePlayerId === targetPlayerId) return false;
    const snapshot = playersRef.current;
    const source = snapshot.find((player) => player.id === sourcePlayerId);
    const target = snapshot.find((player) => player.id === targetPlayerId);
    const dragStart =
      playerDragStartRef.current?.playerId === sourcePlayerId
        ? playerDragStartRef.current
        : null;
    const sourcePosition = dragStart?.position ?? source?.position;
    if (!source || !target?.position || !sourcePosition) return false;
    if (
      miniLeagueTeams &&
      source.teamSide &&
      target.teamSide &&
      source.teamSide !== target.teamSide
    ) {
      return false;
    }

    const sourcePitchPosition = dragStart?.currentPitchPosition ?? source.currentPitchPosition;
    const targetPosition = { ...target.position };
    const targetPitchPosition = target.currentPitchPosition;
    pushToUndoHistory(`Swap: ${source.name} ↔ ${target.name}`, snapshot);
    setPlayers((previousPlayers) =>
      previousPlayers.map((player) => {
        if (player.id === sourcePlayerId) {
          return {
            ...player,
            position: targetPosition,
            currentPitchPosition: targetPitchPosition,
          };
        }
        if (player.id === targetPlayerId) {
          return {
            ...player,
            position: { ...sourcePosition },
            currentPitchPosition: sourcePitchPosition,
          };
        }
        return player;
      }),
    );
    flashSwapFeedback(sourcePlayerId, targetPlayerId);
    return true;
  }, [
    flashSwapFeedback,
    miniLeagueTeams,
    playerDragStartRef,
    playersRef,
    pushToUndoHistory,
    setPlayers,
  ]);

  return {
    capturePlayerDragOffset,
    getClientPitchPosition,
    getClientPointFromPitchPosition,
    getPitchPlayerOverlappingDragged,
    updateDraggedPlayerPosition,
    swapPitchPlayers,
  };
}
