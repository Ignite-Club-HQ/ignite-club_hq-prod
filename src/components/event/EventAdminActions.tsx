import { Bell, MoreVertical, Pencil, Trash2, UserPlus, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ReminderMenuState } from "@/features/events/eventAdminActionPolicy";

export function EventAdminActions({ model, eventTypeLabel, onEdit, onRemind, onResend, onCancel, onDelete }: {
  model: { visible: boolean; showEdit: boolean; reminder: ReminderMenuState; showResend: boolean; showCancel: boolean; showDelete: boolean };
  eventTypeLabel: string;
  onEdit: () => void; onRemind: () => void; onResend: () => void; onCancel: () => void; onDelete: () => void;
}) {
  if (!model.visible) return null;
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="shrink-0" aria-label="Event actions">
      <MoreVertical className="h-5 w-5" />
    </Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="bg-popover">
      {model.showEdit && <DropdownMenuItem onClick={onEdit}><Pencil className="h-4 w-4 mr-2" />Edit {eventTypeLabel}</DropdownMenuItem>}
      {model.reminder === "enabled" && <DropdownMenuItem onClick={onRemind}><Bell className="h-4 w-4 mr-2 text-primary" />Send Reminders</DropdownMenuItem>}
      {model.reminder === "pro-disabled" && <DropdownMenuItem disabled><Bell className="h-4 w-4 mr-2" />Send Reminders<Badge variant="secondary" className="ml-auto text-[10px] h-4 px-1">Pro</Badge></DropdownMenuItem>}
      {model.showResend && <DropdownMenuItem onClick={onResend}><UserPlus className="h-4 w-4 mr-2 text-primary" />Resend Invites</DropdownMenuItem>}
      {(model.showEdit || model.showCancel) && <DropdownMenuSeparator />}
      {model.showCancel && <DropdownMenuItem onClick={onCancel} className="text-warning focus:text-warning"><XCircle className="h-4 w-4 mr-2" />Cancel {eventTypeLabel}</DropdownMenuItem>}
      {model.showDelete && <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive"><Trash2 className="h-4 w-4 mr-2" />Delete {eventTypeLabel}</DropdownMenuItem>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
