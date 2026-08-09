import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { setAppNavigator } from "@/lib/appNavigator";

/**
 * Registers the router's `navigate` with the app navigator bridge so non-React
 * code (deep links, push handlers) can do soft SPA navigation instead of a
 * hard `window.location.href` reload.
 */
export default function AppNavigatorBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    setAppNavigator((path, opts) => navigate(path, { replace: opts?.replace }));
    return () => setAppNavigator(null);
  }, [navigate]);

  return null;
}
