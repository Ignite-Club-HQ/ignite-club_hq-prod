import { Crown } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

interface UsageMeterProps {
  label: string;
  used: number;
  limit: number;
  /** Format used/limit as bytes (MB) instead of integer counts. */
  bytes?: boolean;
  /** When at cap, show an inline upgrade affordance pointing here. */
  clubId?: string | null;
  /** Optional benefit-led message shown under the meter when at cap. */
  capMessage?: string;
  className?: string;
}

const formatBytesMB = (b: number) =>
  b >= 1024 * 1024 * 1024
    ? `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`
    : `${(b / (1024 * 1024)).toFixed(b < 100 * 1024 ? 2 : 0)} MB`;

const fmt = (v: number, bytes?: boolean) => (bytes ? formatBytesMB(v) : `${v}`);

/**
 * Compact inline progress + label. Used to surface Free-tier caps on the
 * media gallery, vault files tab, and poll dialog without resorting to a
 * full-page lock screen.
 */
export function UsageMeter({
  label,
  used,
  limit,
  bytes,
  clubId,
  capMessage,
  className,
}: UsageMeterProps) {
  const navigate = useNavigate();
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const atCap = used >= limit;

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card px-3 py-2.5 space-y-2 text-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        <span
          className={cn(
            "tabular-nums text-xs",
            atCap ? "text-destructive font-semibold" : "text-muted-foreground",
          )}
        >
          {fmt(used, bytes)} / {fmt(limit, bytes)}
        </span>
      </div>
      <Progress value={pct} className="h-1.5" />

      {atCap && capMessage && (
        <p className="text-xs text-muted-foreground pt-1">{capMessage}</p>
      )}

      {atCap && clubId && (
        <button
          type="button"
          onClick={() => navigate(`/clubs/${clubId}/upgrade`)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
        >
          <Crown className="h-3.5 w-3.5" />
          Upgrade to Pro
        </button>
      )}
    </div>
  );
}
