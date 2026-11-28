import { fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ upload: vi.fn(), error: vi.fn(), from: vi.fn(), notify: vi.fn(), team: vi.fn(), pending: vi.fn(), feature: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'member' } }) }));
vi.mock('@/hooks/useClubFreeUsage', () => ({ useClubFreeUsage: () => ({ usage: null }), notifyClubFreeUsageChanged: mocks.notify }));
vi.mock('@/hooks/useScheduleProAccess', () => ({ useScheduleProAccess: () => ({ hasAccess: true }) }));
vi.mock('@/live/authBackendMode', () => ({ resolveAuthBackend: () => 'icp' }));
vi.mock('@/live/mediaUpload', () => ({ tryUploadMediaToBlobStore: mocks.upload }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: mocks.feature }));
vi.mock('@/lib/pendingChatUploads', () => ({ registerPendingChatUpload: mocks.pending }));
vi.mock('@/lib/imageCompression', () => ({ compressImage: async (file: File) => ({ file }) }));
vi.mock('@/lib/chatImageAspectCache', () => ({ measureImageDimensions: async () => null, appendDimensionsToUrl: (url: string) => url, setCachedImageAspectRatio: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: mocks.from } }));
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: vi.fn(), info: vi.fn() } }));
import { ChatImageInput } from './ChatImageInput';
function mount(clubId?: string, teamId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<MemoryRouter><QueryClientProvider client={client}><ChatImageInput clubId={clubId} teamId={teamId} imageUrl={null} onImageUploaded={vi.fn()} /></QueryClientProvider></MemoryRouter>);
  const input = view.container.querySelector('input[type="file"][accept="image/*,video/*"]');
  if (!input) throw new Error('Image picker missing');
  return input;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.feature.mockImplementation(async (feature, providers) => feature === 'membership'
    ? (await mocks.team())[0]?.club_id ?? null : providers.icp({}));
  mocks.team.mockResolvedValue([{ club_id: 'club-a' }]);
  mocks.upload.mockResolvedValue({ url: 'https://store/photo.jpg' });
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview') }));
});
describe('ICP chat photo allowance integration', () => {
  it('keeps a rejected upload pending promise failed and never falls back to email storage', async () => {
    mocks.upload.mockRejectedValueOnce(new Error("You've used your 10 free chat photos this cycle. Upgrade to Pro for unlimited chat photos."));
    fireEvent.change(mount('club-a'), { target: { files: [new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    const job = mocks.pending.mock.calls[0]?.[1];
    await expect(job).rejects.toThrow('10 free chat photos');
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it('resolves team-only uploads into the owning club path and refreshes its meter', async () => {
    fireEvent.change(mount(undefined, 'team-a'), { target: { files: [new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(mocks.upload).toHaveBeenCalled());
    expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({ storagePath: expect.stringMatching(/^clubs\/club-a\/teams\/team-a\/chat\//) }));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith('club-a'));
    expect(mocks.feature).toHaveBeenCalledWith('membership', expect.any(Object), { teamId: 'team-a' });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('never uploads a team photo into uncapped general storage when club discovery fails', async () => {
    mocks.team.mockResolvedValue([]);
    fireEvent.change(mount(undefined, 'team-a'), { target: { files: [new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});