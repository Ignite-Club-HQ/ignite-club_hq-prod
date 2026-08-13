import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const detailPage = readFileSync(
  resolve(process.cwd(), "src/pages/EventDetailPage.tsx"),
  "utf8",
);
const mutationCompletion = readFileSync(
  resolve(process.cwd(), "src/features/events/eventMutationCompletion.ts"),
  "utf8",
);
const rsvpCompletion = readFileSync(
  resolve(process.cwd(), "src/features/events/eventRsvpCompletion.ts"),
  "utf8",
);
const cacheRefresh = readFileSync(
  resolve(process.cwd(), "src/lib/eventCacheRefresh.ts"),
  "utf8",
);

describe("event query-key ownership", () => {
  it("uses canonical keys for core Event Detail reads and cancellation refresh", () => {
    expect(detailPage).toContain("queryKey: eventKeys.detail(id!)");
    expect(detailPage).toContain("queryKey: eventKeys.rsvps(id!)");
    expect(detailPage).toContain("queryKey: eventKeys.duties(id!)");
    expect(detailPage).toContain("queryKey: eventKeys.payments(id!)");
    expect(detailPage).toContain("queryKey: eventKeys.recentReminders(id!)");
    expect(detailPage).toContain("queryKey: eventKeys.goingRsvps(id!)");
    expect(detailPage).toContain("queryKey: eventKeys.groups(id!)");
  });

  it("uses the same family in create/edit/RSVP completion and list refresh", () => {
    expect(mutationCompletion).toContain("eventKeys.home(dependencies.userId!)");
    expect(mutationCompletion).toContain("eventKeys.detail(eventId)");
    expect(rsvpCompletion).toContain("eventKeys.rsvps(options.eventId)");
    expect(rsvpCompletion).toContain("eventKeys.goingRsvps(options.eventId)");
    expect(cacheRefresh).toContain("eventKeys.lists()");
    expect(cacheRefresh).toContain("eventKeys.upcoming()");
    expect(cacheRefresh).toContain("eventKeys.teamNext()");
  });

  it("routes every Event Detail duty mutation through one exact completion policy", () => {
    expect(detailPage.match(/refreshEventDuties\(queryClient, id!\)/g)).toHaveLength(7);
    expect(detailPage).not.toContain('queryKey: ["event-duties", id]');
  });

  it("refreshes payments only through the exact committed-payment policy", () => {
    expect(detailPage.match(/refreshEventPayments\(queryClient, id!\)/g)).toHaveLength(3);
    expect(detailPage).not.toContain('queryKey: ["event-payments", id]');
  });

  it("delegates event role and entitlement resolution to its feature boundary", () => {
    expect(detailPage).toContain("fetchIsAppAdmin(supabase, user!.id)");
    expect(detailPage).toContain("fetchCanManageEvent(supabase, user!.id");
    expect(detailPage).toContain("fetchEventProFootballAccess(");
    expect(detailPage).toContain("fetchEventProAccess(");
    expect(detailPage).not.toContain("EVENT_MANAGER_ROLES.club");
    expect(detailPage).not.toContain("teamSub?.is_pro");
  });
});
