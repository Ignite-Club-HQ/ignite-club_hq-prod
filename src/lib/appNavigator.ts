/**
 * Router navigation bridge for code that lives outside React (deep link
 * handler, push handlers).
 *
 * Deep links used to do `window.location.href = path`, which triggers a full
 * webview reload on Android resume and wipes in-memory state (including an
 * in-progress invite/signup hand-off). Registering the router's `navigate`
 * here lets non-React code do a soft SPA navigation instead, with a hard
 * navigation kept only as a last-resort fallback.
 */
type Navigator = (path: string, opts?: { replace?: boolean }) => void;

let appNavigator: Navigator | null = null;

export function setAppNavigator(nav: Navigator | null) {
  appNavigator = nav;
}

export function navigateApp(path: string, opts?: { replace?: boolean }) {
  if (appNavigator) {
    try {
      appNavigator(path, opts);
      return;
    } catch (err) {
      console.error("[Navigator] Soft navigation failed, falling back", err);
    }
  }
  window.location.href = path;
}
