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

describe('ICP chat alert names', () => {
  it('puts sender and chat name in the title like email mode', () => {
    expect(pushText('message_chat', 'Sam Lee · U12 Riverdogs\u001fSee you at 9')).toEqual({ title: 'Sam Lee · U12 Riverdogs', body: 'See you at 9' });
  });
});

describe('ICP mention and reply alerts', () => {
  it('keeps only title and text from the stored body', () => {
    expect(pushText('message_mention', 'Sam Lee · U12\u001f@Paul see you at 9')).toEqual({ title: 'Sam Lee · U12', body: '@Paul see you at 9' });
  });
  it('labels a reply without a stored name', () => {
    expect(pushText('message_reply', 'Thanks').title).toBe('New reply to you');
  });
});

describe('ICP event alerts', () => {
  it('uses the event name as the title', () => {
    expect(pushText('event_updated', 'Game vs Bulldogs\u001fEvent details have changed')).toEqual({ title: 'Game vs Bulldogs', body: 'Event details have changed' });
  });
});

describe('ICP role and reward alerts', () => {
  it('titles role and reward alerts', () => {
    expect(pushText('role_assigned', 'You have been given the coach role').title).toBe('New role');
    expect(pushText('reward_redeemed', 'You redeemed Free drink').title).toBe('Reward redeemed');
  });
});
