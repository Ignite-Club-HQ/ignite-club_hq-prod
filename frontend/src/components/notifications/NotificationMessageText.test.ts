import { describe, expect, it } from "vitest";
import { notificationRequesterIds, renderNotificationMessage } from "./NotificationMessageText";

describe("join request notification text", () => {
  const msg = "{u:abcde-fgh} wants to join Giddy Goat";
  it("finds the requester", () => expect(notificationRequesterIds(msg)).toEqual(["abcde-fgh"]));
  it("shows the requester's name", () =>
    expect(renderNotificationMessage(msg, new Map([["abcde-fgh", "Jane Smith"]]))).toBe("Jane Smith wants to join Giddy Goat"));
  it("falls back to Someone, never the raw code", () =>
    expect(renderNotificationMessage(msg, new Map())).toBe("Someone wants to join Giddy Goat"));
});
