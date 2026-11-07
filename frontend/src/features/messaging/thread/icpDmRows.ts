import { fetchProfilesWithCache } from '@/lib/profileCache';
import { listLiveReactions } from '@/live/features/messaging';
import { assertReadNotAborted } from '@/live/readDeadline';

/** Text from an authorized page is usable before optional profile/reaction reads. */
export async function mapIcpDmRows(ctx: any, conversationId: string, rows: any[], privateNames: boolean,
  onReady?: (rows: any[]) => void, signal?: AbortSignal): Promise<any[]> {
  assertReadNotAborted(signal);
  const authors = [...new Set(rows.map(row => row.sender.toText() as string))];
  const rawById = new Map(rows.map(row => [row.id, row]));
  const mapRows = (profiles: Map<string, any>, reactions: any[]) => rows.slice()
    .sort((a, b) => Number(b.sequence - a.sequence)).map(row => {
      const authorId = row.sender.toText();
      const profile = profiles.get(authorId);
      const attachment = row.attachment?.[0];
      const replyId = row.reply_to_id?.[0] ?? null;
      const reply = rawById.get(replyId);
      const replyProfile = reply ? profiles.get(reply.sender.toText()) : null;
      return {
        id: row.id, text: row.body, conversation_id: conversationId, author_id: authorId,
        image_url: attachment?.kind === 'image' ? (attachment.url?.[0] ?? attachment.ref_id ?? null) : null,
        created_at: new Date(Number(row.created_at_ms)).toISOString(),
        edited_at: row.edited_at_ms?.[0] ? new Date(Number(row.edited_at_ms[0])).toISOString() : null,
        reply_to_id: replyId, deleted_at: null, forwarded_from_user_id: null, forwarded_at: null, forwarded_source_label: null,
        author: profile ? { display_name: profile.display_name, avatar_url: profile.avatar_url } : null,
        reply_to: reply ? { id: reply.id, text: reply.body, author_id: reply.sender.toText(),
          author: replyProfile ? { display_name: replyProfile.display_name } : null } : null,
        reactions: reactions.filter(r => r.message_id === row.id).map(r => ({
          id: `${r.message_id}:${r.user.toText()}:${r.emoji}`, user_id: r.user.toText(), reaction_type: r.emoji,
        })),
      };
    });
  onReady?.(mapRows(new Map(), []));
  const [profiles, reactions] = await Promise.all([
    privateNames ? Promise.resolve(new Map()) : fetchProfilesWithCache(authors),
    listLiveReactions(ctx, conversationId).catch(() => []),
  ]);
  assertReadNotAborted(signal);
  return mapRows(profiles, reactions);
}