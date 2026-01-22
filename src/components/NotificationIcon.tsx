import {
  Bell,
  MessageSquare,
  Image,
  Calendar,
  Heart,
  Reply,
  UserPlus,
  UserMinus,
  CheckCircle,
  XCircle,
  Megaphone,
  Users,
  ClipboardList,
  AtSign,
  AlertTriangle,
  AlertCircle,
  HardDrive,
  Info,
  type LucideIcon
} from "lucide-react";
import { getNotificationIconConfig } from "@/lib/notificationTypes";
import { cn } from "@/lib/utils";

// Icon name to component mapping
const ICON_MAP: Record<string, LucideIcon> = {
  Bell,
  MessageSquare,
  Image,
  Calendar,
  Heart,
  Reply,
  UserPlus,
  UserMinus,
  CheckCircle,
  XCircle,
  Megaphone,
  Users,
  ClipboardList,
  AtSign,
  AlertTriangle,
  AlertCircle,
  HardDrive,
  Info,
};

export interface NotificationIconProps {
  /** The notification type to display an icon for */
  type: string;
  /** Render mode: 'icon' for Lucide icons, 'emoji' for emoji characters */
  mode?: 'icon' | 'emoji';
  /** Size of the icon (only applies to 'icon' mode) */
  size?: number;
  /** Additional CSS classes */
  className?: string;
  /** Whether to include the color class from config */
  withColor?: boolean;
}

/**
 * A reusable component that renders notification icons consistently across the app.
 * Supports both Lucide icons and emoji rendering based on context.
 */
export function NotificationIcon({
  type,
  mode = 'icon',
  size = 16,
  className,
  withColor = true,
}: NotificationIconProps) {
  const config = getNotificationIconConfig(type);

  if (mode === 'emoji') {
    return (
      <span 
        className={cn("text-xl", className)} 
        role="img" 
        aria-label={type.replace(/_/g, ' ')}
      >
        {config.emoji}
      </span>
    );
  }

  const IconComponent = ICON_MAP[config.iconName] || Bell;
  
  return (
    <IconComponent
      size={size}
      className={cn(
        withColor && config.colorClass,
        className
      )}
    />
  );
}

/**
 * Hook to get notification icon data for custom rendering
 */
export function useNotificationIcon(type: string) {
  const config = getNotificationIconConfig(type);
  const IconComponent = ICON_MAP[config.iconName] || Bell;
  
  return {
    Icon: IconComponent,
    emoji: config.emoji,
    colorClass: config.colorClass,
    iconName: config.iconName,
  };
}
