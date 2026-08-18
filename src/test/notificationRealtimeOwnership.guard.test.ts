import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const authSource = readFileSync(
  resolve(process.cwd(), "src/hooks/useAuth.tsx"),
  "utf8",
);
const pageRealtimeSource = readFileSync(
  resolve(process.cwd(), "src/features/notifications/useNotificationRealtime.ts"),
  "utf8",
);

function notificationChannelExpression(source: string): string {
  const realtimeBlockStart = source.indexOf(".channel(");
  expect(realtimeBlockStart).toBeGreaterThan(-1);
  const expression = source.slice(realtimeBlockStart, realtimeBlockStart + 180);
  expect(expression).toContain("channel");
  return expression;
}

describe("notification Realtime ownership guard", () => {
  it("does not leave either independent owner on the legacy shared static topic", () => {
    expect(authSource).not.toContain(".channel('notifications-realtime')");
    expect(authSource).not.toContain('.channel("notifications-realtime")');
    expect(pageRealtimeSource).not.toContain(".channel('notifications-realtime')");
    expect(pageRealtimeSource).not.toContain('.channel("notifications-realtime")');
  });

  it("uses distinct, user-scoped topics for global and page subscriptions", () => {
    const globalExpression = notificationChannelExpression(authSource);
    const pageExpression = notificationChannelExpression(pageRealtimeSource);

    expect(globalExpression).toMatch(/user\.id/);
    expect(pageExpression).toMatch(/userId/);
    expect(globalExpression).not.toEqual(pageExpression);
  });

  it("keeps every notification callback before its owner's subscribe call", () => {
    for (const source of [authSource, pageRealtimeSource]) {
      const start = source.indexOf(".channel(");
      const subscribe = source.indexOf(".subscribe(", start);
      const callbackPositions = ["INSERT", "UPDATE", "DELETE"].map((event) => {
        const singleQuoted = source.indexOf(`event: '${event}'`, start);
        return singleQuoted >= 0 ? singleQuoted : source.indexOf(`event: "${event}"`, start);
      });

      expect(subscribe).toBeGreaterThan(start);
      for (const callback of callbackPositions) {
        expect(callback).toBeGreaterThan(start);
        expect(callback).toBeLessThan(subscribe);
      }
    }
  });
});
