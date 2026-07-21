import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const channel = vi.fn();
  const removeChannel = vi.fn();
  const websiteClient = { channel, removeChannel };
  return {
    createClient: vi.fn(() => websiteClient),
    channel,
    on: vi.fn(),
    subscribe: vi.fn(),
    removeChannel,
    realtimeHandler: undefined as undefined | ((payload: any) => void),
    channelObject: { id: "payment-channel" },
  };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

mocks.channel.mockImplementation(() => ({ on: mocks.on }));
mocks.on.mockImplementation((_event, _filter, handler) => {
  mocks.realtimeHandler = handler;
  return { subscribe: mocks.subscribe };
});
mocks.subscribe.mockReturnValue(mocks.channelObject);

import {
  createMemberCheckout,
  IGNITE_PLATFORM_FEE_PERCENT,
  listenForPaymentStatus,
} from "./memberCheckout";

const validCheckout = {
  club_id: "club-1",
  title: "Season fees",
  amount_cents: 2500,
  type: "event" as const,
};

describe("member checkout request integrity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ url: "https://checkout.example/session", payment_id: "payment-1" }),
    }));
  });

  it("uses the documented five-percent platform fee and safe defaults", async () => {
    expect(IGNITE_PLATFORM_FEE_PERCENT).toBe(0.05);
    await createMemberCheckout(validCheckout);

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url).endsWith("/functions/v1/create-member-checkout")).toBe(true);
    expect(init).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" } });
    expect(JSON.parse(String(init!.body))).toEqual({
      ...validCheckout,
      currency: "aud",
      success_url: "igniteclubhq://payment-success",
      cancel_url: "igniteclubhq://payment-cancel",
      platform_fee_cents: 125,
      metadata: { platform_fee_cents: "125" },
    });
  });

  it("rounds fractional-cent platform fees deterministically", async () => {
    await createMemberCheckout({ ...validCheckout, amount_cents: 999 });
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]!.body));
    expect(body.platform_fee_cents).toBe(50);
    expect(body.metadata.platform_fee_cents).toBe("50");
  });

  it("preserves custom checkout settings while protecting calculated fee metadata", async () => {
    await createMemberCheckout({
      ...validCheckout,
      currency: "nzd",
      success_url: "igniteclubhq://custom-success",
      cancel_url: "igniteclubhq://custom-cancel",
      metadata: { season: "2030", platform_fee_cents: "tampered" },
      platform_fee_cents: 1,
    });
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]!.body));

    expect(body.currency).toBe("nzd");
    expect(body.success_url).toBe("igniteclubhq://custom-success");
    expect(body.cancel_url).toBe("igniteclubhq://custom-cancel");
    expect(body.platform_fee_cents).toBe(125);
    expect(body.metadata).toEqual({ season: "2030", platform_fee_cents: "125" });
  });

  it("returns the checkout URL and payment identity from a successful response", async () => {
    await expect(createMemberCheckout(validCheckout)).resolves.toEqual({
      url: "https://checkout.example/session",
      payment_id: "payment-1",
    });
  });

  it.each([0, 49, -100, Number.NaN, Number.POSITIVE_INFINITY])(
    "must reject invalid amount_cents=%s before contacting checkout",
    async amount_cents => {
      await expect(createMemberCheckout({ ...validCheckout, amount_cents })).rejects.toThrow(/amount/i);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("must reject a subscription checkout without a billing interval", async () => {
    await expect(createMemberCheckout({ ...validCheckout, type: "subscription" })).rejects.toThrow(/interval/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves a checkout endpoint error for callers to surface", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: vi.fn().mockResolvedValue({ error: "Club payments are disabled" }),
    } as any);

    await expect(createMemberCheckout(validCheckout)).resolves.toEqual({ error: "Club payments are disabled" });
  });
});

describe("member payment realtime lifecycle", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.realtimeHandler = undefined;
    mocks.channel.mockImplementation(() => ({ on: mocks.on }));
    mocks.on.mockImplementation((_event, _filter, handler) => {
      mocks.realtimeHandler = handler;
      return { subscribe: mocks.subscribe };
    });
    mocks.subscribe.mockReturnValue(mocks.channelObject);
  });

  it("subscribes only to updates for the exact payment row", () => {
    listenForPaymentStatus("payment-42", vi.fn());

    expect(mocks.channel).toHaveBeenCalledWith("payment-payment-42");
    expect(mocks.on).toHaveBeenCalledWith("postgres_changes", {
      event: "UPDATE",
      schema: "public",
      table: "member_payments",
      filter: "id=eq.payment-42",
    }, expect.any(Function));
  });

  it.each(["paid", "failed"] as const)("reports terminal %s status and unsubscribes", status => {
    const onStatus = vi.fn();
    listenForPaymentStatus("payment-1", onStatus);
    const payment = { id: "payment-1", status };

    mocks.realtimeHandler!({ new: payment });

    expect(onStatus).toHaveBeenCalledWith(status, payment);
    expect(mocks.removeChannel).toHaveBeenCalledWith(mocks.channelObject);
  });

  it("ignores non-terminal payment updates", () => {
    const onStatus = vi.fn();
    listenForPaymentStatus("payment-1", onStatus);
    mocks.realtimeHandler!({ new: { id: "payment-1", status: "pending" } });

    expect(onStatus).not.toHaveBeenCalled();
    expect(mocks.removeChannel).not.toHaveBeenCalled();
  });

  it("unsubscribes after the configured timeout without reporting a false status", () => {
    const onStatus = vi.fn();
    listenForPaymentStatus("payment-1", onStatus, 5000);
    vi.advanceTimersByTime(4999);
    expect(mocks.removeChannel).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(mocks.removeChannel).toHaveBeenCalledWith(mocks.channelObject);
    expect(onStatus).not.toHaveBeenCalled();
  });

  it("returns a cleanup function for navigation away", () => {
    const cleanup = listenForPaymentStatus("payment-1", vi.fn());
    cleanup();
    expect(mocks.removeChannel).toHaveBeenCalledWith(mocks.channelObject);
  });

  it("must remove the realtime channel at most once when cleanup races a terminal update", () => {
    const cleanup = listenForPaymentStatus("payment-1", vi.fn());
    cleanup();
    mocks.realtimeHandler!({ new: { id: "payment-1", status: "paid" } });
    vi.runAllTimers();

    expect(mocks.removeChannel).toHaveBeenCalledTimes(1);
  });
});
