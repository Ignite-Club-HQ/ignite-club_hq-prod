type TimerLike = {
  teamId?: string | null;
  minutesPerHalf?: number | null;
  lastUpdateTime?: number | null;
};

type PitchLike = {
  teamId?: string | null;
  linkedEventId?: string | null;
  lastUpdateTime?: number | null;
};

const STORAGE_KEY = "pitch-board-halftime-ack-v1";
const MAX_ACKS = 200;
const MAX_ACK_AGE_MS = 90 * 24 * 60 * 60 * 1000;

const readAcks = (): Record<string, number> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const writeAcks = (acks: Record<string, number>) => {
  try {
    const now = Date.now();
    const pruned = Object.fromEntries(
      Object.entries(acks)
        .filter(([, ts]) => typeof ts === "number" && now - ts <= MAX_ACK_AGE_MS)
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_ACKS)
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
  } catch {
    // ignore storage failures
  }
};

const safePart = (value: unknown) => String(value ?? "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");

export const getHalftimePromptAckKey = (
  timerState: TimerLike | null | undefined,
  pitchState: PitchLike | null | undefined
): string | null => {
  const teamId = timerState?.teamId || pitchState?.teamId;
  if (!teamId) return null;

  const eventId = pitchState?.linkedEventId;
  const localBoundary = timerState?.lastUpdateTime || pitchState?.lastUpdateTime || 0;
  const gamePart = eventId ? `event-${eventId}` : `local-${localBoundary}`;
  const minutes = timerState?.minutesPerHalf || "na";

  return `half-time:${safePart(teamId)}:${safePart(gamePart)}:${safePart(minutes)}`;
};

export const hasAcknowledgedHalftimePrompt = (key: string | null | undefined): boolean => {
  if (!key) return false;
  const ts = readAcks()[key];
  return typeof ts === "number" && Date.now() - ts <= MAX_ACK_AGE_MS;
};

export const acknowledgeHalftimePrompt = (key: string | null | undefined): void => {
  if (!key) return;
  const acks = readAcks();
  acks[key] = Date.now();
  writeAcks(acks);
};