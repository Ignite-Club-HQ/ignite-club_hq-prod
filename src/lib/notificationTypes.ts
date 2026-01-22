/**
 * Centralized notification type constants for message-related notifications.
 * Used for filtering and counting unread messages across the app.
 */
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

export type MessageNotificationType = typeof MESSAGE_NOTIFICATION_TYPES[number];
