import { describe, it, expect } from "vitest";
import { describeMyTestAlert } from "./adminQueueOperations";

const s = (o: Partial<{ status: string; outcomes: string[]; devices: number; sharedDevices: number }>) =>
  ({ status: "failed", outcomes: [], devices: 1, sharedDevices: 0, ...o });

describe("describeMyTestAlert", () => {
  it("reports a Firebase-accepted send as sent", () => {
    expect(describeMyTestAlert(s({ status: "delivered", outcomes: ["accepted"] }))).toMatch(/^Sent to your phone/);
  });
  it("says how many registrations were used when the account has several", () => {
    expect(describeMyTestAlert(s({ status: "delivered", outcomes: ["accepted", "inactive"], devices: 2 })))
      .toMatch(/^Sent to 1 of the 2 phone registrations/);
  });
  it("names a missing phone registration", () => {
    expect(describeMyTestAlert(s({ devices: 0 }))).toMatch(/No phone is registered/);
  });
  it("names a phone shared with another account", () => {
    expect(describeMyTestAlert(s({ devices: 1, sharedDevices: 1 }))).toMatch(/another account/);
  });
  it("reports an uncollected alert as still waiting", () => {
    expect(describeMyTestAlert(s({ status: "pending" }))).toMatch(/hasn't collected/);
  });
});
