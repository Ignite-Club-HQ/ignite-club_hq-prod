// Persistent cache of chat image aspect ratios (width / height), keyed by the
// raw storage URL/path (NOT the signed URL — signed URLs rotate per session).
//
// Why this exists:
//   MessageContent reserves a 4:3 box for every image before decode. When the
//   real ratio differs (portrait photos especially), the wrapper resizes once
//   the image loads and Virtuoso has to correct row heights below — visible
//   as "the area grows after the image populates".
//
//   A module-level in-memory Map already absorbs this on re-mounts within a
//   session, but the very first paint after a reload always falls back to 4:3.
//   Persisting the cache to localStorage means once an image has been seen on
//   the device, subsequent loads reserve the correct height before decode.
//
// User-scoped per project rule: stored under the `ignite_` prefix so
// `clearUserScopedCaches()` sweeps it on auth transitions.

const STORAGE_KEY = "ignite_chat_image_ratios_v1";
const MAX_ENTRIES = 800;
const WRITE_DEBOUNCE_MS = 1500;

type Ratios = Record<string, number>;

const memory: Map<string, number> = (globalThis as any).__chatImageAspectRatios
  ?? ((globalThis as any).__chatImageAspectRatios = new Map<string, number>());

let loaded = false;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

function loadOnce() {
  if (loaded) return;
  loaded = true;
  try {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Ratios;
    if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "number" && Number.isFinite(v) && v > 0) {
          memory.set(k, v);
        }
      }
    }
  } catch {
    /* corrupt entry — ignore */
  }
}

function scheduleWrite() {
  dirty = true;
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    if (!dirty) return;
    dirty = false;
    try {
      if (typeof localStorage === "undefined") return;
      // Cap size — drop oldest insertions (Map preserves insertion order).
      if (memory.size > MAX_ENTRIES) {
        const excess = memory.size - MAX_ENTRIES;
        const keys = Array.from(memory.keys()).slice(0, excess);
        for (const k of keys) memory.delete(k);
      }
      const obj: Ratios = {};
      for (const [k, v] of memory) obj[k] = v;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {
      /* quota / unavailable — silent */
    }
  }, WRITE_DEBOUNCE_MS);
}

// Strip query string + fragment so signed URLs and raw storage paths collide
// on the same underlying object.
function normalizeKey(url: string | null | undefined): string | null {
  if (!url) return null;
  const q = url.indexOf("?");
  const base = q >= 0 ? url.slice(0, q) : url;
  return base || null;
}

export function getCachedImageAspectRatio(
  urls: (string | null | undefined)[],
): number | null {
  loadOnce();
  for (const u of urls) {
    const k = normalizeKey(u);
    if (k && memory.has(k)) return memory.get(k)!;
  }
  return null;
}

export function setCachedImageAspectRatio(
  urls: (string | null | undefined)[],
  ratio: number,
): void {
  loadOnce();
  if (!Number.isFinite(ratio) || ratio <= 0) return;
  let changed = false;
  for (const u of urls) {
    const k = normalizeKey(u);
    if (!k) continue;
    if (memory.get(k) !== ratio) {
      memory.set(k, ratio);
      changed = true;
    }
  }
  if (changed) scheduleWrite();
}
