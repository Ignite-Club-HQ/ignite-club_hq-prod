/**
 * Hook to get the stored theme synchronously from localStorage.
 * This prevents hydration mismatches and theme flashes that occur
 * when using useTheme() from next-themes, which returns undefined on initial render.
 */
export function useStoredTheme(): 'light' | 'dark' {
  // Read directly from localStorage - this is synchronous and stable
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('app-theme');
    if (stored === 'dark' || stored === 'light') {
      return stored;
    }
  }
  // Default to light if nothing stored
  return 'light';
}
