/**
 * Centralized notification type constants.
 * Used for filtering, counting, and routing notifications across the app.
 */

// Message-related notifications (shown in Messages tab badge)
export const MESSAGE_NOTIFICATION_TYPES = [
  'team_message',
  'club_message',
  'group_message',
  'broadcast',
  'message_reply',
  'message_reaction',
  'message_mention',
  'direct_message'
] as const;

// Event-related notifications
export const EVENT_NOTIFICATION_TYPES = [
  'event_invite',
  'event_cancelled',
  'event_reminder',
  'event_updated',
  'rsvp_reminder'
] as const;

// Media/photo-related notifications
export const MEDIA_NOTIFICATION_TYPES = [
  'photo_uploaded',
  'photo_comment',
  'photo_reaction',
  'comment_reply',
  'comment_reaction'
] as const;

// Membership and role-related notifications
export const MEMBERSHIP_NOTIFICATION_TYPES = [
  'membership',
  'join_request',
  'role_assigned',
  'role_removed',
  'team_invite'
] as const;

// Admin/system notifications
export const ADMIN_NOTIFICATION_TYPES = [
  'subscription_expiring',
  'subscription_expired',
  'storage_limit',
  'system_announcement'
] as const;

// All notification types combined
export const ALL_NOTIFICATION_TYPES = [
  ...MESSAGE_NOTIFICATION_TYPES,
  ...EVENT_NOTIFICATION_TYPES,
  ...MEDIA_NOTIFICATION_TYPES,
  ...MEMBERSHIP_NOTIFICATION_TYPES,
  ...ADMIN_NOTIFICATION_TYPES
] as const;

// Type exports for type safety
export type MessageNotificationType = typeof MESSAGE_NOTIFICATION_TYPES[number];
export type EventNotificationType = typeof EVENT_NOTIFICATION_TYPES[number];
export type MediaNotificationType = typeof MEDIA_NOTIFICATION_TYPES[number];
export type MembershipNotificationType = typeof MEMBERSHIP_NOTIFICATION_TYPES[number];
export type AdminNotificationType = typeof ADMIN_NOTIFICATION_TYPES[number];
export type NotificationType = typeof ALL_NOTIFICATION_TYPES[number];
