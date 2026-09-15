import { Badge } from "@/components/ui/badge";

export function EventIdentityHeader({
  title,
  clubName,
  teamName,
  isCancelled,
}: {
  title: string;
  clubName?: string | null;
  teamName?: string | null;
  isCancelled?: boolean | null;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">{title}</h1>
        {isCancelled && <Badge variant="destructive">Cancelled</Badge>}
      </div>
      {clubName && <p className="text-muted-foreground">{clubName}</p>}
      {teamName && <Badge variant="outline">{teamName}</Badge>}
    </div>
  );
}
