import { describe, expect, it } from 'vitest';
import { pushText } from '../../../supabase/functions/icp-dev-push-sender/authority.ts';

describe('ICP phone alert wording', () => {
  it('uses the stored message text instead of a generic update', () => {
    expect(pushText('message_chat', ['See you at 9'][0])).toEqual({ title: 'New message', body: 'See you at 9' });
  });
  it('labels sub alerts', () => {
    expect(pushText('pitch_board_substitution', 'A planned substitution is due').title).toBe('Sub due');
  });
  it('falls back only when no text was stored', () => {
    expect(pushText('event_invite', undefined).body).toBe('You have a new update.');
  });
});
