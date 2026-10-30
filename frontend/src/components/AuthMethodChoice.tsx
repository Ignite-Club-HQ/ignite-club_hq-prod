import { Fingerprint, Mail, WifiOff } from "lucide-react";
import { AuthLegalLinks } from "@/components/AuthLegalLinks";

/**
 * The sign-in method picker shown when both systems are genuinely in play:
 * email is still open for a fixed set of clubs, everyone else signs in with
 * Internet Identity.
 *
 * The two options carry equal weight on purpose. Every existing member signs
 * in with email, so the email path must read as a destination in its own
 * right — not a footnote under the secure button.
 */

interface AuthMethodChoiceProps {
  shellStyle: React.CSSProperties;
  onUseEmail: () => void;
  onUseSecure: () => void;
  /** Names of the clubs whose members keep email sign-in. */
  emailClubNames: string[];
  online: boolean;
}

function MethodCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-full flex-col items-start gap-3 rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="rounded-lg bg-primary/10 p-2.5 text-primary" aria-hidden="true">
        {icon}
      </span>
      <span className="block">
        <span className="block font-semibold text-foreground">{title}</span>
        <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

function describeClubList(names: string[]): string {
  const clean = names.map(n => n.trim()).filter(Boolean);
  if (clean.length === 0) return "For members of clubs that still use email sign-in.";
  if (clean.length === 1) return `For ${clean[0]} members.`;
  if (clean.length === 2) return `For ${clean[0]} and ${clean[1]} members.`;
  return `For ${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]} members.`;
}

export function AuthMethodChoice({ shellStyle, onUseEmail, onUseSecure, emailClubNames, online }: AuthMethodChoiceProps) {
  return (
    <main className="flex flex-col bg-background overflow-hidden" style={shellStyle}>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-5 py-12">
        <div className="my-auto w-full max-w-lg">
          <div className="mb-8 flex flex-col items-center text-center">
            <h1 className="text-3xl font-bold text-gradient-emerald leading-tight">Welcome to Ignite</h1>
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">
              How do you sign in?
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <MethodCard
              icon={<Mail className="h-5 w-5" />}
              title="Sign in with email"
              description={describeClubList(emailClubNames)}
              onClick={onUseEmail}
            />
            <MethodCard
              icon={<Fingerprint className="h-5 w-5" />}
              title="Sign in securely"
              description="For everyone else — new clubs and new members."
              onClick={onUseSecure}
            />
          </div>

          {!online && (
            <div
              role="alert"
              aria-live="polite"
              className="mt-6 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground"
            >
              <WifiOff className="h-5 w-5 shrink-0 mt-0.5 text-destructive" aria-hidden="true" />
              <p className="text-muted-foreground text-xs leading-relaxed">
                Signing in needs an internet connection. Reconnect to Wi-Fi or mobile data and try again.
              </p>
            </div>
          )}

          <div className="mt-10">
            <AuthLegalLinks />
          </div>
        </div>
      </div>
    </main>
  );
}
