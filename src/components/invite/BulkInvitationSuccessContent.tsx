import { CheckCircle2, Copy, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export interface BulkInvitationSuccessResult {
  name: string;
  email: string;
  link: string;
  sent: boolean;
  role?: string;
  childrenCount?: number;
}

interface BulkInvitationSuccessContentProps {
  results: BulkInvitationSuccessResult[];
  onCopyLink: (result: BulkInvitationSuccessResult) => void | Promise<void>;
  onAddMore: () => void;
  onDone: () => void;
}

export function BulkInvitationSuccessContent({
  results,
  onCopyLink,
  onAddMore,
  onDone,
}: BulkInvitationSuccessContentProps) {
  return (
    <SheetContent side="bottom" className="h-auto max-h-[85vh] rounded-t-2xl overflow-y-auto">
      <SheetHeader className="mb-6">
        <SheetTitle className="flex items-center gap-2 text-green-600">
          <CheckCircle2 className="h-5 w-5" />
          {results.length} Member{results.length > 1 ? "s" : ""} Added
        </SheetTitle>
        <SheetDescription className="sr-only">
          Review invite delivery results, copy individual invite links, add more members, or finish.
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-4 pb-6">
        {results.map((result) => (
          <div key={`${result.link}:${result.name}`} className="p-3 rounded-lg border bg-muted/30">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium text-sm">{result.name}</p>
                {result.email && <p className="text-xs text-muted-foreground">{result.email}</p>}
              </div>
              <div className="flex items-center gap-2">
                {result.sent ? (
                  <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">
                    <Mail className="h-3 w-3 mr-1" />
                    Sent
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
                    {result.email ? "Failed" : "Link only"}
                  </Badge>
                )}
                <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => void onCopyLink(result)}>
                  <Copy className="h-3.5 w-3.5 mr-1" />
                  Copy link
                </Button>
              </div>
            </div>
          </div>
        ))}

        <div className="flex gap-2 pt-2">
          <Button variant="outline" className="flex-1" onClick={onAddMore}>Add More</Button>
          <Button className="flex-1" onClick={onDone}>Done</Button>
        </div>
      </div>
    </SheetContent>
  );
}
