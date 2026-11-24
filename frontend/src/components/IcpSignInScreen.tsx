import { ExternalLink, Fingerprint, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isLikelyInAppBrowser } from "@/lib/internetIdentitySignInHelp";
import { readRedirectParam, safeSessionGet } from "@/lib/authRedirectStorage";
import { AuthLegalLinks } from "@/components/AuthLegalLinks";
import { AuthBrand } from "@/components/AuthBrand";

interface IcpSignInScreenProps {
  shellStyle: React.CSSProperties;
  onContinue: () => void;
  busy: boolean;
  preparing: boolean;
  native: boolean;
  online: boolean;
  error: string | null;
  /** Switch to the email/Google sign-in screen (?auth=email). */
  onUseEmail: () => void;
  methodTabs?: React.ReactNode;
  showEmailOption?: boolean;
}

// Android can request an external browser. iOS embedded browsers do not
// provide a reliable web API for opening Safari; do not claim otherwise.
export function externalChromeHref(): string | null {
  if (!/Android/i.test(navigator.userAgent)) return null;
  const url = new URL(window.location.href);
  if (url.protocol !== "https:") return null;
  const next = readRedirectParam(url.search) ?? safeSessionGet("redirectAfterAuth");
  if (next?.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")) {
    url.searchParams.set("next", next);
  }
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url.href)};end`;
}

export function IcpSignInScreen({ shellStyle, onContinue, busy, preparing, native, online, error, onUseEmail, methodTabs, showEmailOption = false }: IcpSignInScreenProps) {
  const embedded = !native && isLikelyInAppBrowser();
  const browserHref = embedded ? externalChromeHref() : null;

  return (
    <main className="flex flex-col bg-background overflow-hidden" style={shellStyle}>
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 py-6 sm:py-8">
        <div className="my-auto w-full max-w-sm py-2 text-center">
          <AuthBrand />
          <div className="mt-6">
            <Button type="button" size="lg" className="h-12 w-full rounded-lg" onClick={onContinue} disabled={busy || preparing || !online} aria-busy={busy || preparing}>
              {(busy || preparing) ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Fingerprint className="h-5 w-5" aria-hidden="true" />}
              {busy ? "Signing you in…" : preparing ? "Getting sign-in ready…" : "Continue securely"}
            </Button>
            <p className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              {/* Official id.ai symbol, inline for native and canister hosting. */}
              <svg aria-hidden="true" viewBox="0 0 46 46" className="h-7 w-7 shrink-0" fill="currentColor">
                <path d="M46 23c0-6.07-5.02-11-11.18-11-2.57 0-5.37 1.33-8.33 3.96a37.1 37.1 0 0 0-3.53 3.65c-3.2-3.62-7.5-7.61-11.78-7.61A11.27 11.27 0 0 0 .31 20.45 11.04 11.04 0 0 0 11.1 34c2.56 0 5.44-1.33 8.4-3.96a37.1 37.1 0 0 0 3.53-3.65c3.2 3.62 7.5 7.61 11.78 7.61 5.18 0 9.7-3.63 10.87-8.45.2-.82.31-1.67.31-2.55Zm-22.18-3.4a35.26 35.26 0 0 1 3.1-3.15c2.84-2.52 5.5-3.8 7.9-3.8 5.81 0 10.54 4.64 10.54 10.35 0 .8-.1 1.6-.28 2.38a6.02 6.02 0 0 1-1.52 2.2c-1.44 1.36-3.38 2.05-5.78 2.05A7.28 7.28 0 0 0 42.17 23c0-4-3.3-7.26-7.35-7.26-1.58 0-3.51 1-5.75 2.99-1 .9-2.02 1.94-3.1 3.2l-.42.49-2.16-2.34.43-.49zM20 23.1a34.35 34.35 0 0 1-3.5 3.69c-2.63 2.33-4.34 2.82-5.32 2.82-3.7 0-6.7-2.96-6.7-6.61a6.66 6.66 0 0 1 7.2-6.57c1.9.74 3.6 1.93 4.63 2.88.82.77 2.32 2.33 3.7 3.8zm2.18 3.3a35.38 35.38 0 0 1-3.1 3.15c-2.8 2.49-5.56 3.8-7.98 3.8-2.8 0-5.44-1.08-7.41-3.04a10.24 10.24 0 0 1-2.77-9.69c.03-.1.42-1.16 1.52-2.2 1.44-1.36 3.38-2.05 5.78-2.05A7.28 7.28 0 0 0 3.83 23c0 4 3.3 7.26 7.35 7.26 1.58 0 3.51-1 5.75-2.99 1-.9 2.02-1.94 3.1-3.2l.42-.49 2.15 2.34-.42.49zM26 22.9a34.35 34.35 0 0 1 3.5-3.69c2.63-2.33 4.34-2.82 5.32-2.82 3.7 0 6.7 2.96 6.7 6.61 0 3.65-3 6.6-6.7 6.61-.14 0-.3 0-.5-.04a15.42 15.42 0 0 1-4.63-2.88 95.96 95.96 0 0 1-3.7-3.8zm19.69 2.66z" />
              </svg>
              Powered by Internet Identity
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">No password required.</p>
          </div>
          {error && <p className="mt-5 text-sm leading-relaxed text-destructive" role="alert">{error}</p>}
          {!online && <p className="mt-5 text-sm text-destructive" role="alert">You're offline. Reconnect to sign in.</p>}
          {showEmailOption && <div className="mt-5 border-t border-border pt-4">
            <p className="mb-3 text-sm text-muted-foreground">Already using an email account?</p>
            <Button type="button" variant="outline" className="h-12 w-full rounded-lg" onClick={onUseEmail} disabled={busy}>Sign in with email</Button>
          </div>}
          {!showEmailOption && methodTabs && <div className="mt-2">{methodTabs}</div>}
          <footer className="mt-5 border-t border-border pt-4"><AuthLegalLinks /></footer>
          {embedded && (
            <aside className="mt-5 border-t border-border pt-4 text-left text-sm" aria-label="Browser sign-in guidance">
              <h2 className="font-medium text-foreground">Open Ignite in your browser</h2>
              <p className="mt-2 leading-relaxed text-muted-foreground">Secure sign-in may not work inside this app. Open this page in your device's browser to continue.</p>
              {browserHref && <Button asChild variant="link" className="mt-2 h-auto px-0"><a href={browserHref}><ExternalLink aria-hidden="true" />Open in browser</a></Button>}
            </aside>
          )}
        </div>
      </div>
    </main>
  );
}