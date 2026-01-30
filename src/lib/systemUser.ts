// System user constant for "Ignite Support" - used for welcome DMs
// This is a special UUID that represents the system account
// We handle this ID specially in the UI to show branding and disable replies

export const IGNITE_SUPPORT_USER_ID = "00000000-0000-0000-0000-000000000001";

// Check if a user ID is the Ignite Support system user
export function isIgniteSupportUser(userId: string | null | undefined): boolean {
  return userId === IGNITE_SUPPORT_USER_ID;
}

// Welcome message sent to new users
export const WELCOME_MESSAGE_TEXT = 
  "Welcome to Ignite Club HQ! 🔥 For tips on how to use all of the app's features and help run your club in one place, visit igniteclubhq.com/videos\n\nFor the latest news, join us on Facebook: https://www.facebook.com/share/1BHVkXuKNz/";
