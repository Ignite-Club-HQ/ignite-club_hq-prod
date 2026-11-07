/** Only the canister's exact absent-link response permits registration.
 * All denial/transport failures propagate; registration keeps server-side linking rules. */
export async function ensureIdentityAccount(client: {
  whoami(): Promise<unknown>;
  registerAccount(): Promise<unknown>;
}): Promise<void> {
  try {
    await client.whoami();
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "Unlinked identity") throw error;
    await client.registerAccount();
  }
}