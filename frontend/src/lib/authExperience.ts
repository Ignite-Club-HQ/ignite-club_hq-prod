import type { BackendProvider } from "@/live/backendRouting";

// Device presentation only: no account ids, club ids, credentials or authority.
const SUCCESS_KEY = "ignite.authLastSuccess";
let memoryPreference: BackendProvider | null = null;
let pendingMethod: BackendProvider | null = null;
export function readSuccessfulAuthMethod(): BackendProvider | null {
  try {
    const value = localStorage.getItem(SUCCESS_KEY);
    memoryPreference = value === "supabase" || value === "icp" ? value : null;
    return memoryPreference;
  } catch { return memoryPreference; }
}
export function rememberSuccessfulAuthMethod(method: BackendProvider): void {
  pendingMethod = null;
  memoryPreference = method;
  try { localStorage.setItem(SUCCESS_KEY, method); } catch { /* private browsing */ }
  try { sessionStorage.removeItem("ignite.authChoicePending"); } catch { /* private browsing */ }
}
export function forgetSuccessfulAuthMethod(): void {
  memoryPreference = null;
  try { localStorage.removeItem(SUCCESS_KEY); } catch { /* private browsing */ }
}
export type AuthScreenVariant = "email" | "secure" | "default";
export function readPendingAuthMethod(): BackendProvider | null {
  return pendingMethod;
}
/** Current screen only: an unsuccessful tap must not survive an app restart. */
export function selectPendingAuthMethod(method: BackendProvider | null): void { pendingMethod = method; }
export function readRestoredAuthHint(): BackendProvider | null {
  try {
    const secure = Boolean(localStorage.getItem("ignite_icp_internet_identity_session"));
    let email = false;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("sb-") && key.endsWith("-auth-token") && localStorage.getItem(key)) email = true;
    }
    const old = localStorage.getItem("ignite.authChoice");
    if ((secure || email) && (old === "supabase" || old === "icp")) return old;
    return secure ? "icp" : email ? "supabase" : null;
  } catch { /* hints unavailable */ }
  return null;
}
export function resolveAuthScreenVariant(input: {
  verifiedMethod?: BackendProvider | null;
  selectedMethod?: BackendProvider | null;
  successfulMethod?: BackendProvider | null;
  restoredMethod?: BackendProvider | null;
  secureAvailable: boolean;
}): AuthScreenVariant {
  const method = input.verifiedMethod ?? input.selectedMethod ?? input.successfulMethod ?? input.restoredMethod;
  if (method === "supabase") return "email";
  if (method === "icp") return "secure";
  return input.secureAvailable ? "default" : "email";
}