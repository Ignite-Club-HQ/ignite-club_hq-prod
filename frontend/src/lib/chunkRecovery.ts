// One-time recovery from stale-build chunk failures. After a deploy, a tab
// still running the previous build asks for hashed files that no longer
// exist; the canister answers 404 and the import rejects. We reload once per
// build (guarded in sessionStorage, keyed by the running entry script) so the
// fresh index.html is fetched. A second failure on the same build is surfaced
// instead of looping.
const GUARD_KEY = "ignite_chunk_recovery_build";

export function isChunkLoadFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading chunk .* failed|ChunkLoadError|error loading dynamically imported module|Expected a JavaScript.*module script/i.test(
    message,
  );
}

export function currentBuildId(doc: Document = document): string {
  const script = doc.querySelector<HTMLScriptElement>('script[type="module"][src]');
  return script?.getAttribute("src") || "unknown-build";
}

/** Returns true when a reload was started; false when already tried for this build. */
export function recoverFromChunkFailure(
  storage: Pick<Storage, "getItem" | "setItem"> = window.sessionStorage,
  reload: () => void = () => window.location.reload(),
  buildId: string = currentBuildId(),
): boolean {
  try {
    if (storage.getItem(GUARD_KEY) === buildId) return false;
    storage.setItem(GUARD_KEY, buildId);
  } catch {
    return false;
  }
  reload();
  return true;
}

export function installChunkRecovery(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    const payload = (event as Event & { payload?: unknown }).payload;
    if (recoverFromChunkFailure()) event.preventDefault();
    else console.error("[chunk-recovery] reload already attempted for this build", payload);
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (isChunkLoadFailure(event.reason)) recoverFromChunkFailure();
  });
}
