import { ImageIcon } from "lucide-react";
import { formatMessagePreview as stripMentionFormatting } from "@/lib/messagePreview";

function isSystemReminderText(text: string | null | undefined): boolean {
  if (!text) return false;
  return /\[galleryprompt:[0-9a-f-]{36}\]/i.test(text);
}

const getFirstName = (fullName: string | undefined): string => {
  if (!fullName) return "";
  return fullName.split(" ")[0];
};

const abbreviateClubName = (name: string): string => {
  const words = name.trim().split(/\s+/);
  if (words.length <= 1) return name;
  const firstWord = words[0];
  const initials = words.slice(1).map(w => w.charAt(0).toUpperCase()).join("");
  return `${firstWord} ${initials}`;
};

interface MessagePreviewProps {
  text?: string;
  imageUrl?: string | null;
  author?: string;
  hasUnread?: boolean;
  fallback: string;
  isAnnouncement?: boolean;
  eventTitles?: Record<string, string>;
  vaultFolderNames?: Record<string, string>;
  vaultFileNames?: Record<string, string>;
}

export const MessagePreview = ({
  text,
  imageUrl,
  author,
  fallback,
  isAnnouncement,
  eventTitles,
  vaultFolderNames,
  vaultFileNames,
}: MessagePreviewProps) => {
  const hasText = text && text.trim();
  const isImageOnly = !hasText && imageUrl;
  const hasTextAndImage = hasText && imageUrl;

  const displayText = hasText
    ? stripMentionFormatting(text!, { eventTitles, vaultFolderNames, vaultFileNames })
    : null;

  if (!hasText && !imageUrl && !author) {
    return <span className="text-muted-foreground">{fallback || "No messages yet"}</span>;
  }

  const systemReminder = isSystemReminderText(text);

  return (
    <span className={`line-clamp-2 ${systemReminder ? 'italic text-muted-foreground/80' : ''}`}>
      {(isImageOnly || hasTextAndImage) && (
        <ImageIcon className="h-3.5 w-3.5 inline-block align-text-bottom mr-0.5 text-muted-foreground" />
      )}
      {author && !systemReminder && (
        <span className="font-semibold text-foreground">
          {isAnnouncement ? abbreviateClubName(author) : getFirstName(author)}:{" "}
        </span>
      )}
      {displayText ?? (isImageOnly ? "Image" : "No messages yet")}
    </span>
  );
};
