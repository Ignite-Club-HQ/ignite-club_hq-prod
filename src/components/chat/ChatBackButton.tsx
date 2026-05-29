import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useCallback } from "react";

interface ChatBackButtonProps {
  to?: string;
  label?: string;
}

export function ChatBackButton({ to = "/messages", label = "Messages" }: ChatBackButtonProps) {
  const navigate = useNavigate();

  // Synchronous navigation inside the tap handler — no awaits, no state
  // updates beforehand (iOS gesture rule). onClick is the most reliable
  // cross-platform tap event; onPointerUp was previously swallowed during
  // scroll momentum / overlay dismissal on Android WebView and iOS Safari.
  const handleBack = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      navigate(to);
    },
    [navigate, to],
  );

  return (
    <button
      type="button"
      onClick={handleBack}
      // Larger, square 48x48 target sitting flush with the header's left
      // padding. `relative z-10` ensures the adjacent title button (which
      // is `flex-1` and butts right up against this one) cannot steal taps
      // that land near the right edge. An invisible `::before` pseudo via
      // padding would also work; explicit z-index is simpler and safer.
      className="relative z-10 flex items-center justify-center h-12 w-12 -ml-1 rounded-lg text-foreground active:bg-muted/60 transition-colors shrink-0 touch-manipulation select-none"
      style={{ WebkitTapHighlightColor: "transparent" }}
      aria-label={`Back to ${label}`}
    >
      <ArrowLeft className="h-5 w-5 pointer-events-none" />
    </button>
  );
}
