import { describe, expect, it, vi } from 'vitest';
import { createNativeFcmTransport } from '../../../supabase/functions/icp-dev-push-sender/fcm';

const LIVE = 'https://yabcfiuntwqjwvschnji.supabase.co';

describe('live native FCM transport', () => {
  it('refuses unknown projects and other Firebase accounts', () => {
    expect(() => createNativeFcmTransport({ supabaseUrl: 'https://other.supabase.co', serviceAccountJson: '{}' })).toThrow();
    expect(() => createNativeFcmTransport({ supabaseUrl: LIVE, serviceAccountJson: '' })).toThrow();
    const wrong = JSON.stringify({ project_id: 'someone-else', client_email: 'a@b', private_key: 'k' });
    expect(() => createNativeFcmTransport({ supabaseUrl: LIVE, serviceAccountJson: wrong })).toThrow('mismatch');
  });

  it('accepts the live Firebase account without sending anything on creation', () => {
    const request = vi.fn();
    const ok = JSON.stringify({ project_id: 'ignite-club-hq', client_email: 'a@b', private_key: 'k' });
    expect(typeof createNativeFcmTransport({ supabaseUrl: LIVE, serviceAccountJson: ok }, request)).toBe('function');
    expect(request).not.toHaveBeenCalled();
  });
});
