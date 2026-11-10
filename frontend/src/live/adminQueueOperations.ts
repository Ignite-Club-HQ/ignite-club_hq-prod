import { withFeatureBackend, type FeatureBackendContext } from "./featureRouter";
import { getLivePushDeliveryHealth, getLivePushAlertSettings, upsertLivePushAlertSettings, cleanupLiveStaleDeviceTokens, type LivePushAlertSettingsInput } from "./features/notifications";

const unavailable = async (): Promise<never> => { throw new Error("Internet Identity connection required"); };
export async function adminQueueContexts(): Promise<FeatureBackendContext[]> {
  // Each source read is checked against the full registry before contexts
  // publish. Never treat a partial multi-group reply as the full inventory.
  return withFeatureBackend<FeatureBackendContext[]>("notifications", {
    supabase: unavailable, icp: async ctx => [ctx],
  }, { everyGroup: true, requireComplete: true, merge: parts => [...new Map((parts as FeatureBackendContext[][]).flat().map(ctx => [ctx.target.canisterIds.notification_queue, ctx])).values()] });
}
export async function readAdminQueueHealth() {
  const contexts = await adminQueueContexts();
  return Promise.all(contexts.map(async ctx => ({ queue: ctx.target.canisterIds.notification_queue, ...await getLivePushDeliveryHealth(ctx, Date.now()) })));
}
export async function readAdminQueueSettings() {
  const contexts = await adminQueueContexts();
  return Promise.all(contexts.map(async ctx => ({ queue: ctx.target.canisterIds.notification_queue, ...await getLivePushAlertSettings(ctx) })));
}
export async function saveAdminQueueSettings(value: LivePushAlertSettingsInput) {
  const contexts = await adminQueueContexts();
  let completed = 0;
  try { for (const ctx of contexts) { await upsertLivePushAlertSettings(ctx, value); completed++; } }
  catch { throw new Error(`Saved ${completed} of ${contexts.length} queues; refresh before changing remaining settings`); }
}
export async function cleanupAdminDeviceTokens(ageDays: number) {
  if (!Number.isInteger(ageDays) || ageDays < 1 || ageDays > 3650) throw new Error("Choose a valid token age");
  const contexts = await adminQueueContexts();
  let count = 0;
  let completed = 0;
  try { for (const ctx of contexts) { count += await cleanupLiveStaleDeviceTokens(ctx, Date.now(), ageDays * 86400000); completed++; } }
  catch { throw new Error(`Removed ${count} registrations from ${completed} of ${contexts.length} queues; remaining cleanup is unconfirmed`); }
  return count;
}
/** Queue one generic test alert to the signed-in admin's own phone via the fast native sender. */
export async function queueMyNativeTestAlert(): Promise<string> {
  const [{ getCurrentInternetIdentity }, { getActiveIcpTarget }, { connectLiveNotificationQueue }] = await Promise.all([
    import("./internetIdentityAuth"), import("./targetRegistry"), import("./domains"),
  ]);
  const identity = await getCurrentInternetIdentity();
  if (!identity) throw new Error("Sign in with Internet Identity first");
  const { actor } = await connectLiveNotificationQueue(getActiveIcpTarget(), identity);
  const result = await (actor as unknown as { queue_my_native_test_alert: () => Promise<{ Ok: string } | { Err: string }> }).queue_my_native_test_alert();
  if ("Err" in result) {
    console.warn("queue_my_native_test_alert refused:", result.Err);
    throw new Error(/minute/.test(result.Err) ? "A test alert was just sent. Wait a minute and try again."
      : /not enabled/.test(result.Err) ? "Your account isn't switched on for phone alerts yet."
      : /not configured/.test(result.Err) ? "The fast alert sender isn't switched on here."
      : "The test alert couldn't be queued. Try again shortly.");
  }
  return result.Ok;
}

export type MyTestAlertState = { status: string; outcomes: string[]; devices: number; sharedDevices: number };

/** Follows the caller's own test alert for up to ~20s and explains the outcome in plain English. */
export async function followMyNativeTestAlert(id: string, waitMs = 20000): Promise<string> {
  const [{ getCurrentInternetIdentity }, { getActiveIcpTarget }, { connectLiveNotificationQueue }] = await Promise.all([
    import("./internetIdentityAuth"), import("./targetRegistry"), import("./domains"),
  ]);
  const identity = await getCurrentInternetIdentity();
  if (!identity) throw new Error("Sign in with Internet Identity first");
  const { actor } = await connectLiveNotificationQueue(getActiveIcpTarget(), identity);
  const read = (actor as unknown as { get_my_native_test_alert?: (id: string) => Promise<{ Ok: { status: string; outcomes: string[]; devices: bigint; shared_devices: bigint } } | { Err: string }> }).get_my_native_test_alert;
  if (!read) return "Test alert queued. This version can't follow it to your phone yet.";
  const deadline = Date.now() + waitMs;
  let last: MyTestAlertState | null = null;
  while (Date.now() < deadline) {
    try {
      const r = await read(id);
      if ("Err" in r) { console.warn("get_my_native_test_alert refused:", r.Err); return "Test alert queued, but its progress couldn't be read."; }
      last = { status: r.Ok.status, outcomes: r.Ok.outcomes, devices: Number(r.Ok.devices), sharedDevices: Number(r.Ok.shared_devices) };
      if (last.status === "delivered" || last.status === "failed") break;
    } catch (e) { console.warn("get_my_native_test_alert failed:", e); }
    await new Promise(res => setTimeout(res, 2000));
  }
  return describeMyTestAlert(last);
}

export function describeMyTestAlert(s: MyTestAlertState | null): string {
  if (!s) return "Test alert queued, but its progress couldn't be read.";
  if (s.outcomes.includes("accepted")) return "Sent to your phone. If it doesn't appear, check Do Not Disturb and the notification shade.";
  if (s.status === "pending" || s.status === "processing") return "Queued, but the sender hasn't collected it yet. It will be picked up on the next wake-up.";
  if (s.devices === 0) return "No phone is registered for alerts on this account. Open the app on your phone signed in with Internet Identity and allow notifications.";
  if (s.devices === s.sharedDevices) return "This phone is also registered to another account, so alerts to it are blocked for safety.";
  if (s.outcomes.includes("inactive")) return "Your phone's alert registration had expired. Reopen the app to register again, then retry.";
  return "The alert couldn't be sent to your phone. Try again shortly.";
}
