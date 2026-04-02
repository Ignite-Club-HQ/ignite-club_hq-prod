import { Capacitor } from "@capacitor/core";

/**
 * Cross-platform haptic feedback utility.
 * Uses Capacitor Haptics on native, falls back to navigator.vibrate on web.
 */

let HapticsModule: typeof import("@capacitor/haptics") | null = null;

// Lazy-load the Haptics module only on native platforms
if (Capacitor.isNativePlatform()) {
  import("@capacitor/haptics").then((mod) => {
    HapticsModule = mod;
  });
}

/** Light haptic tap — long-press confirmation, emoji picker open */
export const hapticImpactLight = () => {
  if (HapticsModule && Capacitor.isNativePlatform()) {
    HapticsModule.Haptics.impact({ style: HapticsModule.ImpactStyle.Light }).catch(() => {});
  } else if (navigator.vibrate) {
    navigator.vibrate(12);
  }
};

/** Medium haptic tap — action confirmation */
export const hapticImpactMedium = () => {
  if (HapticsModule && Capacitor.isNativePlatform()) {
    HapticsModule.Haptics.impact({ style: HapticsModule.ImpactStyle.Medium }).catch(() => {});
  } else if (navigator.vibrate) {
    navigator.vibrate(18);
  }
};

/** Tiny selection tick — short tap, swipe threshold */
export const hapticSelectionTick = () => {
  if (HapticsModule && Capacitor.isNativePlatform()) {
    HapticsModule.Haptics.selectionChanged().catch(() => {});
  } else if (navigator.vibrate) {
    navigator.vibrate(6);
  }
};
