type Timer = number;

interface ChatVisualSettleOptions {
  quietMs?: number;
  maxMs?: number;
}

const LOADING_SELECTOR = [
  ".animate-pulse",
  "[data-skeleton]",
  "[data-state='loading']",
  "[aria-busy='true']",
].join(",");

function isImageLoaded(img: HTMLImageElement) {
  return img.complete && img.naturalHeight > 0;
}

/**
 * Holds chat reveal until visible row assets/placeholders stop changing.
 *
 * Chat rows hydrate in stages on a cold login: cached text first, then
 * avatars/signed images/link-card skeletons/read state. Revealing between
 * those stages lets the user see Virtuoso/basic scrollers correct the bottom
 * anchor. This helper waits for pending images and loading placeholders to
 * clear, then requires a short quiet window of unchanged scroll metrics.
 */
export function waitForChatVisualContentSettle(
  root: HTMLElement | null,
  options: ChatVisualSettleOptions,
  done: () => void,
) {
  if (!root || typeof window === "undefined") {
    done();
    return () => {};
  }

  const quietMs = options.quietMs ?? 520;
  const maxMs = options.maxMs ?? 2400;
  let finished = false;
  let quietTimer: Timer | null = null;
  let maxTimer: Timer | null = null;
  let rafId: number | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  let lastSignature = "";
  const imageListeners = new Map<HTMLImageElement, () => void>();

  const clearQuietTimer = () => {
    if (quietTimer !== null) {
      window.clearTimeout(quietTimer);
      quietTimer = null;
    }
  };

  const cleanup = () => {
    clearQuietTimer();
    if (maxTimer !== null) window.clearTimeout(maxTimer);
    if (rafId !== null) window.cancelAnimationFrame(rafId);
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    imageListeners.forEach((handler, img) => {
      img.removeEventListener("load", handler);
      img.removeEventListener("error", handler);
    });
    imageListeners.clear();
    maxTimer = null;
    rafId = null;
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    cleanup();
    done();
  };

  const scheduleCheck = () => {
    if (finished || rafId !== null) return;
    rafId = window.requestAnimationFrame(check);
  };

  const attachPendingImageListeners = (pendingImages: HTMLImageElement[]) => {
    pendingImages.forEach((img) => {
      if (imageListeners.has(img)) return;
      const handler = () => scheduleCheck();
      imageListeners.set(img, handler);
      img.addEventListener("load", handler, { once: true });
      img.addEventListener("error", handler, { once: true });
    });
  };

  function check() {
    rafId = null;
    if (finished || !root.isConnected) {
      finish();
      return;
    }

    const pendingImages = Array.from(root.querySelectorAll<HTMLImageElement>("img")).filter(
      (img) => !isImageLoaded(img),
    );
    attachPendingImageListeners(pendingImages);

    const loadingCount = root.querySelectorAll(LOADING_SELECTOR).length;
    const signature = [
      pendingImages.length,
      loadingCount,
      Math.round(root.scrollTop),
      Math.round(root.scrollHeight),
      Math.round(root.clientHeight),
      root.firstElementChild?.childElementCount ?? root.childElementCount,
    ].join(":");

    const ready = pendingImages.length === 0 && loadingCount === 0;
    if (!ready || signature !== lastSignature) {
      lastSignature = signature;
      clearQuietTimer();
      if (ready) quietTimer = window.setTimeout(finish, quietMs);
      return;
    }

    if (quietTimer === null) quietTimer = window.setTimeout(finish, quietMs);
  }

  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(scheduleCheck);
    resizeObserver.observe(root);
    if (root.firstElementChild instanceof HTMLElement) {
      resizeObserver.observe(root.firstElementChild);
    }
  }

  mutationObserver = new MutationObserver(scheduleCheck);
  mutationObserver.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });

  maxTimer = window.setTimeout(finish, maxMs);
  scheduleCheck();

  return () => {
    finished = true;
    cleanup();
  };
}