import { expect, it, vi } from "vitest";
vi.mock("@/live/targetRegistry", () => ({ getActiveSupabaseTarget: () => ({ url: "https://live-target.supabase.co/", anonKey: "public-key" }) }));
import { supabaseOrigin, supabasePublishableKey } from "./supabaseEndpoint";

it("uses the live app's own backend address, not the unset VITE setting", () => {
  expect(import.meta.env.VITE_SUPABASE_URL).toBeFalsy();
  expect(supabaseOrigin()).toBe("https://live-target.supabase.co");
  expect(supabasePublishableKey()).toBe("public-key");
});
