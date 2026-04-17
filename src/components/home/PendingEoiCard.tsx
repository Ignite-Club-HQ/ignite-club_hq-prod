import { useNavigate } from "react-router-dom";
import { ClipboardList, ArrowRight, PartyPopper } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMyPendingEois } from "@/hooks/useMyEois";
import { EOI_STATUS_LABELS } from "@/lib/eoiUtils";

/**
 * Shows any pending Expression of Interest submissions on the Home page so the
 * parent can complete details or confirm allocation without needing the email.
 */
export function PendingEoiCard() {
  const navigate = useNavigate();
  const { data: eois = [], isLoading } = useMyPendingEois();

  if (isLoading || eois.length === 0) return null;

  return (
    <div className="space-y-2">
      {eois.map((e) => {
        const isAllocated = e.status === "allocated";
        return (
          <Card
            key={e.id}
            className={isAllocated ? "border-primary/50 bg-primary/5" : ""}
          >
            <CardContent className="p-3 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                {isAllocated ? (
                  <PartyPopper className="h-5 w-5 text-primary" />
                ) : (
                  <ClipboardList className="h-5 w-5 text-primary" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate text-sm">
                  {isAllocated
                    ? `${e.player_name} has been placed!`
                    : `Complete ${e.player_name}'s EOI`}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant="secondary" className="text-xs capitalize">
                    {EOI_STATUS_LABELS[e.status] ?? e.status}
                  </Badge>
                </div>
              </div>
              <Button
                size="sm"
                variant={isAllocated ? "default" : "outline"}
                onClick={() => navigate(`/eoi-complete/${e.claim_token}`)}
              >
                {isAllocated ? "Confirm" : "Finish"}
                <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
