import type { ReactNode, SyntheticEvent } from "react";
import { useToast } from "@/hooks/use-toast";

/**
 * Keeps admin tools visible when the organiser club has no Pro, but turns any
 * press on them into a "Pro only" message instead of running the action.
 *
 * `scope="all"` blocks every press inside (header buttons, forms).
 * `scope="actions"` blocks buttons and form controls but lets plain links
 * through, so locked admins can still open fixtures and match pages in panels.
 */
export const PRO_ONLY_TITLE = "Pro only";
export const PRO_ONLY_DESCRIPTION =
  "Managing competitions needs Club Pro on the organising club. Upgrade the club to use this.";

const ACTION_SELECTOR =
  'button, input, select, textarea, [role="button"], [role="switch"], [role="checkbox"], [role="combobox"], [role="menuitem"], [role="tab"]';
const ALL_SELECTOR = `${ACTION_SELECTOR}, a`;

export function ProOnlyGate({
  locked,
  scope = "all",
  onUpgrade,
  children,
  className,
}: {
  locked: boolean;
  scope?: "all" | "actions";
  onUpgrade?: () => void;
  children: ReactNode;
  className?: string;
}) {
  const { toast } = useToast();
  if (!locked) return <>{children}</>;

  const selector = scope === "all" ? ALL_SELECTOR : ACTION_SELECTOR;
  const intercept = (event: SyntheticEvent) => {
    const target = event.target as HTMLElement | null;
    const hit = target?.closest?.(selector);
    if (!hit || !(event.currentTarget as HTMLElement).contains(hit)) return;
    if (scope === "actions" && hit.getAttribute("role") === "tab") return;
    event.preventDefault();
    event.stopPropagation();
    toast({ title: PRO_ONLY_TITLE, description: PRO_ONLY_DESCRIPTION });
    void onUpgrade;
  };

  return (
    <div
      className={className ?? "contents"}
      data-pro-locked="true"
      onClickCapture={intercept}
      onPointerDownCapture={(e) => {
        // Radix triggers (sheets, menus) open on pointerdown; stop them silently.
        const hit = (e.target as HTMLElement | null)?.closest?.(selector);
        if (hit && e.currentTarget.contains(hit)) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onKeyDownCapture={(e) => {
        if (e.key === "Enter" || e.key === " ") intercept(e);
      }}
    >
      {children}
    </div>
  );
}
