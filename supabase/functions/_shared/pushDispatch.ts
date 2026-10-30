// Shared fan-out helper for calling send-push-notification from other edge
// functions. Small groups + pause between groups + retry on transient failures
// so large chats don't have requests silently dropped under load.

export interface PushDispatchItem {
  userId: string;
  notificationId?: string;
  // Any other fields are forwarded verbatim as the request body.
  [key: string]: unknown;
}

export interface PushDispatchResult {
  sent: number;
  failed: number;
  failedUserIds: string[];
}

const RETRY_DELAYS_MS = [500, 1500];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendOne(
  endpoint: string,
  anonKey: string,
  item: PushDispatchItem,
  logPrefix: string,
): Promise<boolean> {
  const maxAttempts = RETRY_DELAYS_MS.length + 1;
  let lastStatus: number | null = null;
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let retryable = false;
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anonKey}` },
        body: JSON.stringify(item),
      });
      try { await r.body?.cancel(); } catch { /* ignore */ }
      if (r.ok) return true;
      lastStatus = r.status;
      lastError = null;
      retryable = r.status === 429 || r.status >= 500;
    } catch (err) {
      lastStatus = null;
      lastError = err instanceof Error ? err.message : String(err);
      retryable = true;
    }

    if (!retryable || attempt === maxAttempts) {
      console.error(`${logPrefix} push failed`, {
        userId: item.userId,
        notificationId: item.notificationId ?? null,
        status: lastStatus,
        error: lastError,
        attempts: attempt,
      });
      return false;
    }
    const base = RETRY_DELAYS_MS[attempt - 1];
    const jitter = attempt === 2 ? Math.floor(Math.random() * 500) : 0;
    await sleep(base + jitter);
  }
  return false;
}

export async function dispatchPushRequests(
  supabaseUrl: string,
  anonKey: string,
  items: PushDispatchItem[],
  opts: { concurrency?: number; pauseMs?: number; logPrefix?: string } = {},
): Promise<PushDispatchResult> {
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 5, 5));
  const pauseMs = opts.pauseMs ?? 150;
  const logPrefix = opts.logPrefix ?? '[NOTIFY]';
  const endpoint = `${supabaseUrl}/functions/v1/send-push-notification`;

  let sent = 0;
  const failedUserIds: string[] = [];

  for (let i = 0; i < items.length; i += concurrency) {
    if (i > 0 && pauseMs > 0) await sleep(pauseMs);
    const group = items.slice(i, i + concurrency);
    const results = await Promise.all(group.map((it) => sendOne(endpoint, anonKey, it, logPrefix)));
    results.forEach((ok, idx) => {
      if (ok) sent++;
      else failedUserIds.push(group[idx].userId);
    });
  }

  return { sent, failed: failedUserIds.length, failedUserIds };
}
