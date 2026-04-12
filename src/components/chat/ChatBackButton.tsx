import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

interface ChatBackButtonProps {
  to?: string;
  label?: string;
}

export function ChatBackButton({ to = "/messages", label = "Messages" }: ChatBackButtonProps) {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate(to)}
      className="flex items-center gap-1 min-h-[44px] min-w-[44px] px-1 -ml-2 rounded-lg text-foreground active:bg-muted/60 transition-colors shrink-0"
      aria-label={`Back to ${label}`}
    >
      <ArrowLeft className="h-5 w-5 shrink-0" />
      <span className="text-sm font-medium text-primary truncate max-w-[80px]">{label}</span>
    </button>
  );
}
