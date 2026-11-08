// TEST-only provisioning. No runner activation, queue mutation, token read or send.
export const DEV_PUSH_PROJECT = 'ecsdwrarzfexssxtrymj';
export const DEV_PUSH_BASE_QUEUE = 'jfcdq-yiaaa-aaaal-qxloa-cai';
export const DEV_WORKER_SECRET = 'IGNITE_DEV_ICP_PUSH_WORKER_SEED';

export function validateDevWorkerProvisioning({ ref, confirmation, seed, accessToken, existingNames }) {
  if (ref !== 'refs/heads/main' || confirmation !== 'TRANSFER EXISTING TEST PUSH WORKER') throw new Error('TEST worker transfer approval required');
  if (!/^[a-fA-F0-9]{64}$/.test(seed ?? '') || !accessToken) throw new Error('Existing TEST worker or hosting access is unavailable');
  if (!Array.isArray(existingNames) || existingNames.some(name => typeof name !== 'string')) throw new Error('TEST secret inventory unavailable');
  if (existingNames.includes(DEV_WORKER_SECRET)) throw new Error('TEST worker secret already exists; refusing overwrite');
}

export async function provisionExistingDevWorker(config, request = fetch) {
  const endpoint = `https://api.supabase.com/v1/projects/${DEV_PUSH_PROJECT}/secrets`;
  if (config.ref !== 'refs/heads/main' || config.confirmation !== 'TRANSFER EXISTING TEST PUSH WORKER' ||
      !/^[a-fA-F0-9]{64}$/.test(config.seed ?? '') || !config.accessToken) throw new Error('TEST worker transfer requirements unavailable');
  const headers = { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' };
  const inventory = await request(endpoint, { headers, signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!inventory.ok) throw new Error(`TEST secret inventory refused [${inventory.status}]`);
  const rows = await inventory.json();
  validateDevWorkerProvisioning({ ...config, existingNames: Array.isArray(rows) ? rows.map(row => row.name) : undefined });
  // Exactly one write; a lost response must never cause an automatic replay.
  const result = await request(endpoint, { method: 'POST', headers, body: JSON.stringify([{ name: DEV_WORKER_SECRET, value: config.seed }]), signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!result.ok) throw new Error(`TEST worker transfer refused [${result.status}]; verify before repeating`);
  const readback = await request(endpoint, { headers, signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!readback.ok) throw new Error('TEST worker transfer readback unavailable; do not repeat transfer');
  const verified = await readback.json();
  if (!Array.isArray(verified) || !verified.some(row => row.name === DEV_WORKER_SECRET)) throw new Error('TEST worker transfer unconfirmed; do not repeat transfer');
  return { transferred: true, deliveryEnabled: false, grantsVerified: false };
}