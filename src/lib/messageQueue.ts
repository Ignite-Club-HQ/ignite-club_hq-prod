import { supabase } from "@/integrations/supabase/client";

export interface QueuedMessage {
  id: string;
  type: "team" | "club" | "group" | "broadcast";
  targetId: string; // team_id, club_id, group_id
  authorId: string;
  text: string;
  imageUrl: string | null;
  replyToId: string | null;
  createdAt: string;
  retryCount: number;
}

const QUEUE_KEY = "ignite_message_queue";
const MAX_RETRIES = 3;

// Get all queued messages
export function getQueuedMessages(): QueuedMessage[] {
  try {
    const stored = localStorage.getItem(QUEUE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

// Save queue to localStorage
function saveQueue(queue: QueuedMessage[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // localStorage might be full
    console.error("Failed to save message queue");
  }
}

// Add a message to the queue
export function queueMessage(message: Omit<QueuedMessage, "id" | "retryCount">): QueuedMessage {
  const queue = getQueuedMessages();
  const queuedMessage: QueuedMessage = {
    ...message,
    id: `queued-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    retryCount: 0,
  };
  queue.push(queuedMessage);
  saveQueue(queue);
  return queuedMessage;
}

// Remove a message from the queue
export function removeFromQueue(id: string) {
  const queue = getQueuedMessages();
  const filtered = queue.filter((m) => m.id !== id);
  saveQueue(filtered);
}

// Get queued messages for a specific target
export function getQueuedMessagesForTarget(type: QueuedMessage["type"], targetId: string): QueuedMessage[] {
  return getQueuedMessages().filter((m) => m.type === type && m.targetId === targetId);
}

// Send a single queued message to the server
async function sendQueuedMessage(message: QueuedMessage): Promise<boolean> {
  try {
    let error;

    switch (message.type) {
      case "team":
        ({ error } = await supabase.from("team_messages").insert({
          team_id: message.targetId,
          author_id: message.authorId,
          text: message.text,
          image_url: message.imageUrl,
          reply_to_id: message.replyToId,
        }));
        break;
      case "club":
        ({ error } = await supabase.from("club_messages").insert({
          club_id: message.targetId,
          author_id: message.authorId,
          text: message.text,
          image_url: message.imageUrl,
          reply_to_id: message.replyToId,
        }));
        break;
      case "group":
        ({ error } = await supabase.from("group_messages").insert({
          group_id: message.targetId,
          author_id: message.authorId,
          text: message.text,
          image_url: message.imageUrl,
          reply_to_id: message.replyToId,
        }));
        break;
      case "broadcast":
        ({ error } = await supabase.from("broadcast_messages").insert({
          author_id: message.authorId,
          text: message.text,
          image_url: message.imageUrl,
          reply_to_id: message.replyToId,
        }));
        break;
      default:
        return false;
    }

    if (error) {
      console.error("Failed to send queued message:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error sending queued message:", error);
    return false;
  }
}

// Sync all queued messages - returns number of messages synced
export async function syncQueuedMessages(): Promise<{ synced: number; failed: number }> {
  const queue = getQueuedMessages();
  if (queue.length === 0) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;
  const remainingQueue: QueuedMessage[] = [];

  for (const message of queue) {
    const success = await sendQueuedMessage(message);
    
    if (success) {
      synced++;
    } else {
      message.retryCount++;
      if (message.retryCount < MAX_RETRIES) {
        remainingQueue.push(message);
      } else {
        failed++;
        console.error("Message exceeded max retries, discarding:", message.id);
      }
    }
  }

  saveQueue(remainingQueue);
  return { synced, failed };
}

// Check if there are any queued messages
export function hasQueuedMessages(): boolean {
  return getQueuedMessages().length > 0;
}

// Get queue count
export function getQueueCount(): number {
  return getQueuedMessages().length;
}
