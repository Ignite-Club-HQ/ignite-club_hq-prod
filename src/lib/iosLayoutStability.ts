export const IOS_LAYOUT_RESET_EVENT = "ignite:ios-layout-reset";
export const IOS_NAV_GUARD_EVENT = "ignite:ios-nav-guard";

interface IOSNavGuardDetail {
  durationMs?: number;
}

const canUseDOM = () => typeof window !== "undefined" && typeof document !== "undefined";

export const emitIOSLayoutReset = () => {
  if (!canUseDOM()) return;
  window.dispatchEvent(new CustomEvent(IOS_LAYOUT_RESET_EVENT));
};

export const emitIOSNavGuard = (durationMs = 900) => {
  if (!canUseDOM()) return;
  window.dispatchEvent(
    new CustomEvent<IOSNavGuardDetail>(IOS_NAV_GUARD_EVENT, {
      detail: { durationMs },
    }),
  );
};

export const readSafeAreaInsetBottomPx = () => {
  if (!canUseDOM()) return 0;

  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.left = "0";
  probe.style.bottom = "0";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.paddingBottom = "env(safe-area-inset-bottom, 0px)";

  document.body.appendChild(probe);
  const inset = Number.parseFloat(window.getComputedStyle(probe).paddingBottom || "0");
  probe.remove();

  return Number.isFinite(inset) ? inset : 0;
};
