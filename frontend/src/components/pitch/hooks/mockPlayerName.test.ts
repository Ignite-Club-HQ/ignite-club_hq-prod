import { describe, it, expect } from 'vitest';
import { mockPlayerName } from './usePitchBoardMockPlayers';
describe('mockPlayerName', () => {
  it('restores sample names from their id', () => {
    expect(mockPlayerName('mock-1')).toBe('Alex Smith');
    expect(mockPlayerName('mock-15')).toBe('Reese Walker');
    expect(mockPlayerName('mock-16')).toBe('Player 16');
    expect(mockPlayerName('child-1')).toBeUndefined();
  });
});
