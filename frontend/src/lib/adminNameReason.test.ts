import { describe, expect, it } from 'vitest';
import { adminNameReason } from './adminNameReason';
describe('admin name reasons', () => {
  it('explains a mismatched saved name in plain words', () => {
    expect(adminNameReason('Original private-name binding changed')).toContain('save their name again');
  });
  it('explains a missing admin role', () => {
    expect(adminNameReason('App admin required')).toContain('admin access');
  });
  it('explains an unset member directory', () => {
    expect(adminNameReason('Membership directory unconfigured')).toContain('directory');
  });
  it('never echoes unknown server text', () => {
    expect(adminNameReason('Weird internal trap 0xdead')).toBe("Couldn't unlock this name.");
  });
});
