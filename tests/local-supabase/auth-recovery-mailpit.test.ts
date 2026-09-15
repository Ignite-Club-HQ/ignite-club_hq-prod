import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSyntheticLocalMarker, service } from "./fixtures";

const mailpitUrl = "http://127.0.0.1:54324";

type MailpitMessage = {
  ID?: string;
  To?: Array<{ Address?: string }>;
  Subject?: string;
};

async function messages(): Promise<MailpitMessage[]> {
  const response = await fetch(`${mailpitUrl}/api/v1/messages?limit=100`);
  expect(response.status).toBe(200);
  const body = await response.json() as { messages?: MailpitMessage[] };
  return body.messages ?? [];
}

async function waitForRecoveryEmail(email: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const match = (await messages()).find((message) =>
      message.To?.some((recipient) => recipient.Address?.toLowerCase() === email.toLowerCase()),
    );
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Local recovery email was not delivered to Mailpit");
}

describe("local Auth: password recovery through Mailpit", () => {
  const email = `recovery.${crypto.randomUUID()}@local.invalid`;
  const password = `Local-only-${crypto.randomUUID()}!`;
  let userId: string;

  beforeAll(async () => {
    await assertSyntheticLocalMarker();
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw created.error ?? new Error("Local recovery fixture failed");
    userId = created.data.user.id;
  });
  afterAll(async () => { if (userId) await service.auth.admin.deleteUser(userId); });

  const anonymous = () => createClient(process.env.LOCAL_SUPABASE_URL!, process.env.LOCAL_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  it("accepts a recovery request and delivers only to the requested local user", async () => {
    const result = await anonymous().auth.resetPasswordForEmail(email, {
      redirectTo: "http://127.0.0.1:3000/reset-password",
    });
    expect(result.error).toBeNull();
    const message = await waitForRecoveryEmail(email);
    expect(message.Subject?.toLowerCase()).toContain("reset");
    expect(message.To).toHaveLength(1);
    expect(message.To?.[0]?.Address?.toLowerCase()).toBe(email.toLowerCase());
  });

  it("does not disclose whether an unknown account exists or emit mail for it", async () => {
    const unknown = `unknown.${crypto.randomUUID()}@local.invalid`;
    const before = await messages();
    const result = await anonymous().auth.resetPasswordForEmail(unknown, {
      redirectTo: "http://127.0.0.1:3000/reset-password",
    });
    expect(result.error).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const after = await messages();
    expect(after.some((message) =>
      message.To?.some((recipient) => recipient.Address?.toLowerCase() === unknown.toLowerCase()),
    )).toBe(false);
    expect(after.length).toBe(before.length);
  });
});
