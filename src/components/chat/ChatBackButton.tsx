import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

interface ChatBackButtonProps {
  to?: string;
  label?: string;
}

export function ChatBackButton({ to = "/messages", label = "Messages" }: ChatBackButtonProps) {
  const navigate = useNavigate();

  const handleBack = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigate(to);
  };

  return (
    <button
      type="button"
      onPointerUp={handleBack}
      onClick={(e) => {
        // Fallback for non-pointer environments; pointerup already handled it on touch.
        e.preventDefault();
        e.stopPropagation();
      }}
      className="flex items-center justify-center min-h-[48px] min-w-[48px] h-12 w-12 -ml-3 rounded-lg text-foreground active:bg-muted/60 transition-colors shrink-0 touch-manipulation"
      aria-label={`Back to ${label}`}
    >
      <ArrowLeft className="h-5 w-5" />
    </button>
  );
}
