import { useEffect } from "react";

let lockCount = 0;
let savedRootStyles: {
  htmlOverflow: string;
  htmlOverscrollBehavior: string;
  bodyOverflow: string;
  bodyOverscrollBehavior: string;
} | null = null;

const isIOSEnvironment = () => {
  if (typeof navigator === "undefined") return false;

  const userAgent = navigator.userAgent;
  const isIOSDevice = /iPad|iPhone|iPod/.test(userAgent);
  const isIpadDesktopMode = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const capacitorPlatform = (window as Window & { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.();

  return isIOSDevice || isIpadDesktopMode || capacitorPlatform === "ios";
};

export function useIOSOverlayScrollLock(active: boolean) {
  useEffect(() => {
    if (!active || !isIOSEnvironment()) return;

    const html = document.documentElement;
    const body = document.body;

    if (lockCount === 0) {
      savedRootStyles = {
        htmlOverflow: html.style.overflow,
        htmlOverscrollBehavior: html.style.overscrollBehavior,
        bodyOverflow: body.style.overflow,
        bodyOverscrollBehavior: body.style.overscrollBehavior,
      };

      html.style.overflow = "hidden";
      html.style.overscrollBehavior = "none";
      body.style.overflow = "hidden";
      body.style.overscrollBehavior = "none";
    }

    lockCount += 1;

    return () => {
      lockCount = Math.max(0, lockCount - 1);

      if (lockCount === 0) {
        html.style.overflow = savedRootStyles?.htmlOverflow ?? "";
        html.style.overscrollBehavior = savedRootStyles?.htmlOverscrollBehavior ?? "";
        body.style.overflow = savedRootStyles?.bodyOverflow ?? "";
        body.style.overscrollBehavior = savedRootStyles?.bodyOverscrollBehavior ?? "";
        savedRootStyles = null;
      }
    };
  }, [active]);
}
