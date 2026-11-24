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
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 py-8 sm:py-12">
        <div className="my-auto w-full max-w-sm py-4 text-center">
          <AuthBrand />
          <div className="mt-8">
            <Button type="button" size="lg" className="h-12 w-full rounded-lg" onClick={onContinue} disabled={busy || preparing || !online} aria-busy={busy || preparing}>
              {(busy || preparing) ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Fingerprint className="h-5 w-5" aria-hidden="true" />}
              {busy ? "Signing you in…" : preparing ? "Getting sign-in ready…" : "Continue securely"}
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">Powered by Internet Identity</p>
            <p className="mt-5 text-sm leading-relaxed text-muted-foreground">{showEmailOption ? "Passwordless sign-in and account creation." : "Simple, passwordless access to your Ignite account."}</p>
          </div>
          {error && <p className="mt-5 text-sm leading-relaxed text-destructive" role="alert">{error}</p>}
          {!online && <p className="mt-5 text-sm text-destructive" role="alert">You're offline. Reconnect to sign in.</p>}
          {showEmailOption && <div className="mt-7 border-t border-border pt-6">
            <p className="mb-3 text-sm text-muted-foreground">Already using an email account?</p>
            <Button type="button" variant="outline" className="h-12 w-full rounded-lg" onClick={onUseEmail} disabled={busy}>Sign in with email</Button>
          </div>}
          {methodTabs && <div className="mt-3">{methodTabs}</div>}
          <footer className="mt-7 border-t border-border pt-5"><AuthLegalLinks /></footer>
          {embedded && (
            <aside className="mt-8 border-t border-border pt-5 text-left text-sm" aria-label="Browser sign-in guidance">
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